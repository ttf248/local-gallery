package services

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const (
	pageCursorVersion      = 1
	maxEncodedCursorLength = 4096
	maxCursorScopeLength   = 1024
)

var (
	// ErrInvalidPageCursor 表示游标损坏、被篡改，或被用于其他分页作用域。
	ErrInvalidPageCursor = errors.New("invalid page cursor")
	// ErrStalePageCursor 表示游标属于旧的目录 revision，调用方应从第一页重试。
	ErrStalePageCursor = errors.New("stale page cursor")

	pageCursorSigningKey = newPageCursorSigningKey()
)

type pageCursorPayload struct {
	Version  int    `json:"v"`
	Revision uint64 `json:"r"`
	Scope    string `json:"s"`
	Offset   int    `json:"o"`
}

func newPageCursorSigningKey() []byte {
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err == nil {
		return key
	}
	// crypto/rand 在 Go 支持的平台上不会正常失败。保留确定性兜底只为
	// 避免极端环境中服务无法启动；revision/scope/offset 仍会被严格校验。
	sum := sha256.Sum256([]byte("local-gallery-page-cursor-fallback-v1"))
	return sum[:]
}

// EncodePageCursor 生成只在当前进程、指定目录 revision 和作用域内有效的
// 不透明游标。游标不包含文件系统路径。
func EncodePageCursor(revision uint64, scope string, offset int) (string, error) {
	if revision == 0 || scope == "" || len(scope) > maxCursorScopeLength || offset < 0 {
		return "", fmt.Errorf("%w: invalid payload", ErrInvalidPageCursor)
	}
	payload, err := json.Marshal(pageCursorPayload{
		Version:  pageCursorVersion,
		Revision: revision,
		Scope:    scope,
		Offset:   offset,
	})
	if err != nil {
		return "", fmt.Errorf("encode page cursor: %w", err)
	}
	signature := signPageCursor(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." +
		base64.RawURLEncoding.EncodeToString(signature), nil
}

// DecodePageCursor 校验游标签名、格式、作用域与 revision。
func DecodePageCursor(raw string, revision uint64, scope string) (int, error) {
	if raw == "" || len(raw) > maxEncodedCursorLength || revision == 0 || scope == "" {
		return 0, ErrInvalidPageCursor
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return 0, ErrInvalidPageCursor
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, ErrInvalidPageCursor
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(signature, signPageCursor(payload)) {
		return 0, ErrInvalidPageCursor
	}

	var decoded pageCursorPayload
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&decoded); err != nil {
		return 0, ErrInvalidPageCursor
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return 0, ErrInvalidPageCursor
	}
	if decoded.Version != pageCursorVersion || decoded.Revision == 0 ||
		decoded.Scope == "" || len(decoded.Scope) > maxCursorScopeLength || decoded.Offset < 0 {
		return 0, ErrInvalidPageCursor
	}
	if decoded.Scope != scope {
		return 0, ErrInvalidPageCursor
	}
	if decoded.Revision != revision {
		return 0, ErrStalePageCursor
	}
	return decoded.Offset, nil
}

func signPageCursor(payload []byte) []byte {
	mac := hmac.New(sha256.New, pageCursorSigningKey)
	_, _ = mac.Write(payload)
	return mac.Sum(nil)
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("trailing cursor payload")
	}
	return nil
}
