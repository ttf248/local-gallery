package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/config"
)

type ComicMetadataQuery struct {
	Title   string
	Aliases []string
}
type ComicMetadataMatch struct {
	Title, OriginalTitle, Author, Synopsis, Status, Provider, ExternalID string
	Genres                                                               []string
	Year                                                                 int
	Confidence                                                           float64
}
type ComicMetadataProvider interface {
	Name() string
	SearchWork(context.Context, ComicMetadataQuery) (*ComicMetadataMatch, error)
}
type BangumiProvider struct {
	config func() config.ComicMetaConfig
	slot   chan struct{}
	next   time.Time
}

func (*BangumiProvider) Name() string { return "bangumi" }

var htmlTags = regexp.MustCompile("<[^>]*>")

func plainComicText(v string) string {
	return strings.Join(strings.Fields(html.UnescapeString(htmlTags.ReplaceAllString(v, " "))), " ")
}
func (p *BangumiProvider) SearchWork(ctx context.Context, q ComicMetadataQuery) (*ComicMetadataMatch, error) {
	cfg := p.config()
	if !cfg.OnlineEnabled {
		return nil, ErrOnlineComicDisabled
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(cfg.TimeoutSec)*time.Second)
	defer cancel()
	select {
	case p.slot <- struct{}{}:
		defer func() { <-p.slot }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if wait := time.Until(p.next); wait > 0 {
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if !p.config().OnlineEnabled {
		return nil, ErrOnlineComicDisabled
	}
	p.next = time.Now().Add(time.Second)
	transport := http.DefaultTransport.(*http.Transport).Clone()
	defer transport.CloseIdleConnections()
	transport.Proxy = nil
	if cfg.ProxyURL != "" {
		u, err := url.Parse(cfg.ProxyURL)
		if err != nil {
			return nil, err
		}
		transport.Proxy = http.ProxyURL(u)
	}
	body, _ := json.Marshal(map[string]any{"keyword": q.Title, "sort": "match", "filter": map[string]any{"type": []int{1}}})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.bgm.tv/v0/search/subjects?limit=5", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "ttf248/local-gallery/2 (https://github.com/ttf248/local-gallery)")
	resp, err := (&http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		if resp.StatusCode == 429 {
			secs, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
			p.next = time.Now().Add(time.Duration(min(3600, max(8, secs))) * time.Second)
		}
		return nil, errors.New("comic provider unavailable")
	}
	var result struct {
		Data []struct {
			ID      int
			Name    string
			NameCN  string `json:"name_cn"`
			Summary string
			Date    string
			Tags    []struct{ Name string }
			Infobox []struct {
				Key   string
				Value json.RawMessage
			}
		}
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil {
		return nil, err
	}
	var best *ComicMetadataMatch
	normalize := func(s string) string { return strings.ToLower(strings.Join(strings.Fields(s), "")) }
	for _, v := range result.Data {
		score := 0.
		for _, name := range []string{v.Name, v.NameCN} {
			a, b := normalize(name), normalize(q.Title)
			if a == b {
				score = 1
				break
			}
			if a != "" && b != "" && (strings.Contains(a, b) || strings.Contains(b, a)) {
				score = max(score, float64(min(len([]rune(a)), len([]rune(b))))/float64(max(len([]rune(a)), len([]rune(b)))))
			}
		}
		if score < .72 || best != nil && score <= best.Confidence {
			continue
		}
		m := &ComicMetadataMatch{Title: firstNonEmpty([]string{v.NameCN, v.Name}), OriginalTitle: v.Name, Synopsis: comicText(plainComicText(v.Summary), 2000), Provider: p.Name(), ExternalID: strconv.Itoa(v.ID), Confidence: score}
		for _, t := range v.Tags[:min(len(v.Tags), 8)] {
			m.Genres = append(m.Genres, comicText(t.Name, 24))
		}
		for _, field := range v.Infobox {
			if field.Key == "作者" {
				_ = json.Unmarshal(field.Value, &m.Author)
			}
		}
		if len(v.Date) >= 4 {
			m.Year, _ = strconv.Atoi(v.Date[:4])
		}
		best = m
	}
	return best, nil
}
