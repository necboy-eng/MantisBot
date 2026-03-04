# 本地OCR引擎对比

## 引擎概览

| 引擎 | 语言 | 速度 | 准确率 | 安装难度 |
|------|------|------|--------|----------|
| PaddleOCR | Python | 快 | 高 | 中等 |
| Tesseract | 多语言 | 快 | 中 | 简单 |
| EasyOCR | Python | 慢 | 高 | 简单 |

## PaddleOCR

**百度开源**, 支持80+语言

### 优点
- 速度快、准确率高
- 支持文本方向检测
- 支持表格识别
- 中文识别效果好

### 安装
```bash
pip install paddlepaddle paddleocr
```

### 使用
```python
from paddleocr import PaddleOCR
ocr = PaddleOCR(use_angle_cls=True, lang='ch')
result = ocr.ocr('image.png', cls=True)
```

## Tesseract

**Google开源**, 历史最悠久

### 优点
- 安装简单
- 支持100+语言
- 社区资源丰富
- 轻量级

### 安装
```bash
# macOS
brew install tesseract

# Ubuntu
sudo apt-get install tesseract-ocr

# Python
pip install pytesseract
```

### 语言包
- `chi_sim` - 简体中文
- `chi_tra` - 繁体中文
- `eng` - 英文
- `jpn` - 日文
- `kor` - 韩文

## EasyOCR

**基于深度学习**, 开箱即用

### 优点
- 开箱即用, 无需配置
- 识别效果好
- 支持70+语言
- 可定制训练

### 缺点
- 首次运行需下载模型(100MB+)
- 速度较慢

### 安装
```bash
pip install easyocr
```

### 使用
```python
import easyocr
reader = easyocr.Reader(['ch_sim', 'en'])
result = reader.readtext('image.png')
```

## 选择建议

1. **中文为主**: PaddleOCR > EasyOCR > Tesseract
2. **英文为主**: Tesseract > PaddleOCR
3. **追求速度**: Tesseract > PaddleOCR
4. **追求准确**: PaddleOCR ≈ EasyOCR
