# 云端OCR API对比

## 主流API概览

| 服务商 | API名称 | 准确率 | 价格 | 中文支持 |
|--------|---------|--------|------|----------|
| Google Cloud Vision | Text Detection | 高 | 免费1000次/月 | 优秀 |
| Azure | Computer Vision | 高 | 免费5000次/月 | 优秀 |
| 百度AI | OCR | 高 | 免费有限 | 优秀 |
| 腾讯云 | OCR | 高 | 免费有限 | 优秀 |
| 阿里云 | OCR | 高 | 免费有限 | 优秀 |

## Google Cloud Vision

### 安装
```bash
pip install google-cloud-vision
```

### 使用
```python
from google.cloud import vision

client = vision.ImageAnnotatorClient()
with open('image.png', 'rb') as f:
    image = vision.Image(content=f.read())

response = client.text_detection(image=image)
text = response.text_annotations[0].description if response.text_annotations else ''
```

### 价格
- 免费: 1000次/月
- 付费: $1.50/1000次

## Azure Computer Vision

### 安装
```bash
pip install azure-cognitiveservices-vision-computervision
```

### 使用
```python
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from msrest.authentication import CognitiveServicesCredentials

credential = CognitiveServicesCredentials('KEY')
client = ComputerVisionClient('ENDPOINT', credential)

with open('image.png', 'rb') as f:
    result = client.read_in_stream(f, raw=True)
```

### 价格
- 免费: 5000次/月 (S0层)
- 付费: $1.50/1000次

## 百度OCR

### 安装
```bash
pip install baidu-aip
```

### 使用
```python
from aip import AipOcr

client = AipOcr(APP_ID, API_KEY, SECRET_KEY)
with open('image.png', 'rb') as f:
    result = client.basicGeneral(f.read())
    for word in result['words_result']:
        print(word['words'])
```

### 价格
- 免费: 500次/天(通用), 1000次/天(高精度)
- 付费: ¥0.0025/次起

## 选择建议

1. **个人/小项目**: 推荐百度OCR或Google Vision免费额度
2. **企业级应用**: Azure或Google Cloud稳定可靠
3. **国内业务**: 百度/腾讯/阿里云延迟更低
4. **国际业务**: Google Vision支持最广
