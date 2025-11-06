# 测试运行指南

## 问题解决

如果您看到错误："Test provider in adapter is not unittest. Please reload window."

### 解决方案

1. **重新加载窗口**
   - 按 `Ctrl+Shift+P` (Windows/Linux) 或 `Cmd+Shift+P` (macOS)
   - 输入 "Reload Window"
   - 选择 "Developer: Reload Window"

2. **检查测试框架配置**
   - 确保VS Code使用unittest而不是pytest
   - 配置文件已生成：`.vscode/settings.json`

## 运行测试

### 方法1：通过命令行
```bash
# 运行完整测试套件
cd tests
python test_suite.py

# 运行特定测试
python -m unittest test_image_processor
```

### 方法2：通过VS Code
1. 按 `F5` 键运行测试
2. 或点击"Run Test"按钮

### 方法3：通过Python模块
```bash
# 从项目根目录
python -m unittest discover tests -p "test_*.py" -v
```

## 测试文件结构

```
tests/
├── README.md              # 本文件
├── TEST_REPORT.md         # 详细测试报告
├── base_test.py          # 基础测试类
├── conftest.py           # Pytest配置
├── test_suite.py         # 完整测试套件
├── test_image_processor.py  # ImageProcessor测试
└── utils/
    └── test_image_processor.py
```

## 测试覆盖范围

### ImageProcessor
- ✅ get_image_files - 图片文件获取
- ✅ format_size - 文件大小格式化
- ✅ scan_albums - 相册扫描
- ✅ create_smart_groups - 智能分组
- ✅ 进度回调机制

### AlbumScannerService
- ✅ 服务初始化
- ✅ 线程安全队列
- ✅ 取消机制

### 性能测试
- ✅ 扫描速度测试
- ✅ 内存使用测试
- ✅ 并发扫描测试

## 预期结果

运行测试时，您应该看到类似输出：

```
============================================================
IMAGE PROCESSOR TESTS
============================================================

[Test 1] get_image_files
  PASS - Found 5 images

[Test 2] format_size
  PASS - Size formatting works

[Test 3] scan_albums
  PASS - Found 4 albums

[Test 4] Performance
  PASS - 1 albums in 0.010s (98.4/s)

[Test 5] Progress callback
  PASS - 5 progress updates

============================================================
FINAL RESULTS: 5 passed, 0 failed
============================================================

ALL TESTS PASSED!
```

## 故障排除

### 如果测试失败

1. **检查Python路径**
   ```bash
   export PYTHONPATH=$PWD/src
   ```

2. **检查依赖**
   ```bash
   pip install -r requirements.txt
   ```

3. **重新运行测试**
   ```bash
   python test_suite.py
   ```

### 如果VS Code仍然报错

1. 重启VS Code
2. 检查测试文件编码（应为UTF-8）
3. 确认Python解释器版本（推荐Python 3.7+）

## 性能基准

| 测试场景 | 预期时间 | 实际性能 |
|----------|----------|----------|
| 小规模 (10 albums) | < 0.1s | ~0.009s |
| 中规模 (50 albums) | < 0.1s | ~0.022s |
| 内存使用 | 稳定 | 无泄漏 |

如果性能测试超过预期时间，请检查磁盘I/O和系统性能。
