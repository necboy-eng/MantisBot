---
name: ocr
description: 通用光学字符识别(OCR)技能，支持从图片和PDF中提取文字。使用场景包括：(1) 识别图片中的文字 (2) 提取截图内容 (3) 扫描文档转文字 (4) 发票/名片等文档数字化。支持多种输出格式(纯文本/JSON/Markdown)，可选择本地引擎(Tesseract/PaddleOCR)或云端API(Google Vision/Azure/百度)。
---

# OCR Skill

## 快速开始

### 本地OCR (推荐优先)

使用Python进行OCR识别：

```python
# 使用 PaddleOCR (推荐)
from paddleocr import PaddleOCR
ocr = PaddleOCR(use_angle_cls=True, lang='ch')
result = ocr.ocr(image_path, cls=True)
for line in result[0]:
    print(line[1][0])  # 识别文字

# 使用 Tesseract
import pytesseract
from PIL import Image
text = pytesseract.image_to_string(Image.open(image_path), lang='chi_sim+eng')
```

### 云端OCR API

```python
# Google Vision API
from google.cloud import vision
client = vision.ImageAnnotatorClient()
response = client.text_detection(image=vision.Image(source=vision.ImageSource(image_uri)))
print(response.text_annotations[0].description)

# Azure Computer Vision
import azure.cognitiveservices.vision.computervision as cv
client = cv.ComputerVisionClient(auth, credentials)
result = client.read_in_stream(image_stream, raw=True)
```

## 输出格式

根据需求选择输出格式：

| 格式 | 用途 | 适用场景 |
|------|------|----------|
| plain | 纯文本 | 直接复制使用 |
| json | 结构化数据 | 程序处理 |
| markdown | 格式化文档 | 整理成文档 |

## 支持的文件类型

- **图片**: PNG, JPG, JPEG, BMP, TIFF, WebP
- **文档**: PDF (需要先转换为图片或使用专门PDF OCR)

## 常用命令

### 使用Python脚本 (推荐)

参考 `scripts/ocr_image.py` 进行图片OCR：

```bash
python scripts/ocr_image.py input.png --output result.txt --lang ch
```

### PDF OCR

对于PDF文件，需要先转换为图片：

```python
# 使用 pdf2image
from pdf2image import convert_from_path
images = convert_from_path('document.pdf')
for i, image in enumerate(images):
    image.save(f'page_{i+1}.png', 'PNG')
```

## Resources

### scripts/

- `ocr_image.py` - 图片OCR主脚本
- `ocr_pdf.py` - PDF文档OCR脚本
- `batch_ocr.py` - 批量处理脚本

### references/

- `local_engines.md` - 本地OCR引擎对比(Tesseract/PaddleOCR/EasyOCR)
- `cloud_apis.md` - 云端OCR API对比与使用指南
- `language_support.md` - 支持的语言列表
