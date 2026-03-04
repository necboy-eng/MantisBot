#!/usr/bin/env python3
"""
OCR Image Script - 使用本地引擎识别图片中的文字
支持: PaddleOCR, Tesseract, EasyOCR
"""

import argparse
import json
import sys
from pathlib import Path

def ocr_with_paddle(image_path, lang='ch', output_format='plain'):
    """使用 PaddleOCR 进行识别"""
    try:
        from paddleocr import PaddleOCR

        ocr = PaddleOCR(use_angle_cls=True, lang=lang)
        result = ocr.ocr(image_path, cls=True)

        if output_format == 'plain':
            lines = [line[1][0] for line in result[0]]
            return '\n'.join(lines)
        elif output_format == 'json':
            return json.dumps(result[0], ensure_ascii=False, indent=2)
    except ImportError:
        print("请安装 PaddleOCR: pip install paddleocr", file=sys.stderr)
        sys.exit(1)

def ocr_with_tesseract(image_path, lang='chi_sim+eng', output_format='plain'):
    """使用 Tesseract 进行识别"""
    try:
        import pytesseract
        from PIL import Image

        image = Image.open(image_path)
        text = pytesseract.image_to_string(image, lang=lang)

        if output_format == 'json':
            # 返回更详细的结构
            data = pytesseract.image_to_data(image, lang=lang, output_type=pytesseract.Output.DICT)
            result = []
            for i, txt in enumerate(data['text']):
                if txt.strip():
                    result.append({
                        'text': txt,
                        'conf': data['conf'][i],
                        'left': data['left'][i],
                        'top': data['top'][i]
                    })
            return json.dumps(result, ensure_ascii=False, indent=2)
        return text
    except ImportError:
        print("请安装 pytesseract: pip install pytesseract", file=sys.stderr)
        sys.exit(1)

def ocr_with_easyocr(image_path, lang=['ch_sim', 'en'], output_format='plain'):
    """使用 EasyOCR 进行识别"""
    try:
        import easyocr

        reader = easyocr.Reader(lang)
        result = reader.readtext(image_path)

        if output_format == 'plain':
            lines = [line[1] for line in result]
            return '\n'.join(lines)
        elif output_format == 'json':
            return json.dumps(result, ensure_ascii=False, indent=2)
    except ImportError:
        print("请安装 EasyOCR: pip install easyocr", file=sys.stderr)
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description='OCR图片文字识别')
    parser.add_argument('input', help='输入图片路径')
    parser.add_argument('-o', '--output', help='输出文件路径 (可选)')
    parser.add_argument('-f', '--format', choices=['plain', 'json', 'markdown'],
                        default='plain', help='输出格式')
    parser.add_argument('-e', '--engine', choices=['paddle', 'tesseract', 'easyocr'],
                        default='paddle', help='OCR引擎')
    parser.add_argument('-l', '--lang', default='ch',
                        help='语言代码: ch, en, ja, ko 等 (paddle/tesseract)')

    args = parser.parse_args()

    # 选择OCR引擎
    if args.engine == 'paddle':
        text = ocr_with_paddle(args.input, args.lang, args.format)
    elif args.engine == 'tesseract':
        text = ocr_with_tesseract(args.input, args.lang, args.format)
    elif args.engine == 'easyocr':
        lang_map = {'ch': ['ch_sim', 'en'], 'en': ['en'], 'ja': ['ja'], 'ko': ['ko']}
        lang = lang_map.get(args.lang, ['ch_sim', 'en'])
        text = ocr_with_easyocr(args.input, lang, args.format)

    # Markdown格式转换
    if args.format == 'markdown':
        lines = text.split('\n') if args.engine != 'paddle' else text.split('\n')
        text = '\n'.join([f'> {line}' for line in lines if line.strip()])

    # 输出
    if args.output:
        Path(args.output).write_text(text, encoding='utf-8')
        print(f"结果已保存到: {args.output}")
    else:
        print(text)

if __name__ == '__main__':
    main()
