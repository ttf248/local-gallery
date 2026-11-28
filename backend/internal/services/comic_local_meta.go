package services

import (
	"encoding/json"
	"encoding/xml"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
)

const comicSidecarLimit = 64 << 10

type comicSidecar struct {
	Title       string
	Series      string
	Author      string
	Writer      string
	Summary     string
	Synopsis    string
	Description string
	Genre       string
	Genres      []string
	Year        int
	Status      string
}

func comicText(s string, limit int) string {
	r := []rune(strings.TrimSpace(s))
	return string(r[:min(len(r), limit)])
}
func readComicLocalMeta(dir string, collection bool, validate func(string) (string, error)) ComicWorkIntel {
	if validate == nil {
		return ComicWorkIntel{}
	}
	for _, name := range []string{"ComicInfo.xml", "series.json", "info.json"} {
		path, err := validate(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		info, err := os.Lstat(path)
		if err != nil {
			continue
		}
		if !info.Mode().IsRegular() || info.Size() > comicSidecarLimit {
			log.Print("comic_metadata_rejected")
			continue
		}
		file, err := os.Open(path)
		if err != nil {
			continue
		}
		actual, err := file.Stat()
		if err != nil || !os.SameFile(info, actual) || !actual.Mode().IsRegular() {
			file.Close()
			continue
		}
		data, err := io.ReadAll(io.LimitReader(file, comicSidecarLimit+1))
		file.Close()
		if err != nil || len(data) > comicSidecarLimit {
			continue
		}
		var raw comicSidecar
		if name == "ComicInfo.xml" {
			err = xml.Unmarshal(data, &raw)
		} else {
			err = json.Unmarshal(data, &raw)
			var wrapped struct {
				Metadata struct {
					comicSidecar
					Name string
				} `json:"metadata"`
			}
			if err == nil && raw.Title == "" && json.Unmarshal(data, &wrapped) == nil && wrapped.Metadata.Name != "" {
				raw = wrapped.Metadata.comicSidecar
				raw.Title = wrapped.Metadata.Name
			}
		}
		if err != nil {
			log.Print("comic_metadata_malformed")
			continue
		}
		title := raw.Title
		if collection && raw.Series != "" {
			title = raw.Series
		}
		author := raw.Author
		if author == "" {
			author = raw.Writer
		}
		synopsis := firstNonEmpty([]string{raw.Synopsis, raw.Summary, raw.Description})
		genres := raw.Genres
		if len(genres) == 0 {
			genres = strings.FieldsFunc(raw.Genre, func(r rune) bool { return strings.ContainsRune(",，、;", r) })
		}
		if title == "" && author == "" && synopsis == "" && len(genres) == 0 {
			continue
		}
		for i := range genres {
			genres[i] = comicText(genres[i], 24)
		}
		return ComicWorkIntel{Title: comicText(title, 120), Author: comicText(author, 80), Synopsis: comicText(synopsis, 2000), Genres: genres[:min(len(genres), 8)], Year: raw.Year, Status: raw.Status, Source: ComicMetaSourceLocalFile, Provider: name}
	}
	return ComicWorkIntel{}
}
