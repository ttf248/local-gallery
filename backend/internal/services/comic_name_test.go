package services

import "testing"

func TestParseComicNames(t *testing.T) {
	for raw, want := range map[string]string{"douluodalu 斗罗大陆": "斗罗大陆", "dpcqylcq 斗破苍穹之药老传奇": "斗破苍穹之药老传奇", "lz2dwzzt 龙族2悼亡者之瞳": "龙族2悼亡者之瞳", "lz3hyzc 龙族3黑月之潮": "龙族3黑月之潮", "shenjingbang 神精榜 [全彩]": "神精榜", "ONE PIECE 海贼王": "ONE PIECE 海贼王", "JOJO 奇妙冒险": "JOJO 奇妙冒险", "Fate 命运之夜": "Fate 命运之夜", "Re0 从零开始": "Re0 从零开始", "EVA 新世纪福音战士": "EVA 新世纪福音战士"} {
		p := ParseComicWorkName(raw)
		if p.CleanTitle != want || p.RawName != raw {
			t.Errorf("%s: %+v", raw, p)
		}
	}
}
func TestParseComicEpisodes(t *testing.T) {
	for _, tc := range []struct {
		raw, title, label string
		kind              ComicEpisodeType
	}{{"0016 第1话 唐三穿越(上)", "唐三穿越(上)", "第 1 话", ComicEpisodeMain}, {"0002 番外2", "番外 2", "番外 2", ComicEpisodeExtra}, {"0001", "第 1 话", "第 1 话", ComicEpisodeMain}, {"斗罗大陆 Ch.12.5 重逢", "重逢", "第 12.5 话", ComicEpisodeMain}, {"0003 公告", "公告", "公告", ComicEpisodeSpecial}, {"Vol.02", "第 2 卷", "第 2 卷", ComicEpisodeVolume}} {
		p := ParseComicEpisodeName(tc.raw, "斗罗大陆")
		if p.CleanTitle != tc.title || p.ChapterLabel != tc.label || p.EpisodeType != tc.kind {
			t.Errorf("%s: %+v", tc.raw, p)
		}
	}
}
