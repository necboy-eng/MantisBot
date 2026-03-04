# OCR语言支持

## PaddleOCR语言代码

| 语言 | 代码 | 语言 | 代码 |
|------|------|------|------|
| 中文 | ch | 英文 | en |
| 日文 | ja | 韩文 | ko |
| 德文 | de | 法文 | fr |
| 西班牙文 | es | 俄文 | ru |
| 阿拉伯文 | ar | 意大利文 | it |

完整列表参考: https://github.com/PaddlePaddle/PaddleOCR/tree/master/ppocr/utils/dict

## Tesseract语言代码

| 语言 | 代码 | 语言 | 代码 |
|------|------|------|------|
| 简体中文 | chi_sim | 繁体中文 | chi_tra |
| 英文 | eng | 日文 | jpn |
| 韩文 | kor | 法文 | fra |
| 德文 | deu | 西班牙文 | spa |
| 意大利文 | ita | 俄文 | rus |

### 语言组合
```python
lang = 'chi_sim+eng'  # 简体中文+英文
```

## EasyOCR语言代码

```python
# 单语言
reader = easyocr.Reader(['en'])

# 多语言
reader = easyocr.Reader(['ch_sim', 'en'])  # 简体中文+英文
reader = easyocr.Reader(['ja', 'en'])      # 日文+英文
reader = easyocr.Reader(['ko', 'en'])      # 韩文+英文
```

完整语言列表: https://www.jaided.ai/easyocr/

## 云端API语言支持

### Google Vision
支持所有主要语言,自动检测

### Azure Computer Vision
支持30+语言

### 百度OCR
中文(简体繁体)、英文、日文、韩文等
