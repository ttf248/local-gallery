# API 文档

> 占位，将在 **T15 集成测试 + 文档定稿** 阶段完整化。

## REST 端点

| 方法 | 路径 | 说明 | 状态 |
|------|------|------|------|
| GET | `/api/health` | 健康检查 | T2 |
| POST | `/api/scan` | 同步扫描 | T4 |
| POST | `/api/scan/start` | 启动异步扫描 | T6 |
| GET | `/api/scan/:id/events` | SSE 进度流 | T6 |
| DELETE | `/api/scan/:id` | 取消扫描 | T6 |
| GET | `/api/albums/*/images` | 相册图片列表 | T4 |
| GET | `/api/thumbs/:key.png` | 缩略图 | T5 |
| GET | `/api/images/*` | 全图（支持 Range） | T11 |
| GET / POST / DELETE | `/api/favorites` | 收藏 | T7 |
| GET / POST / DELETE | `/api/history` | 最近 | T7 |
| GET / PATCH | `/api/prefs` | 偏好 | T7 |
| GET | `/api/images/*/info` | 图片元数据（EXIF） | T12 |
| GET | `/api/fs/open?path=` | 打开系统文件管理器 | T14 |

## SSE 事件格式

```
event: progress
data: {"scanId":"abc","progress":42,"status":"running","currentPath":"..."}

event: complete
data: {"scanId":"abc","albumCount":42,"duration":1234}

event: error
data: {"scanId":"abc","error":"..."}

event: cancelled
data: {"scanId":"abc"}
```

---

详细请求/响应 schema、错误码、示例将在 T15 完成。
