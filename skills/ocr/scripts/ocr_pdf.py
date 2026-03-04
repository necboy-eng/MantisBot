#!/usr/bin/env python3
"""
OCR PDF Script - 识别PDF文档中的文字
支持将PDF每一页转换为图片后进行OCR
"""

import argparse
import json
import sys
from pathlib import Path

def pdf_to_images(pdf_path):
    """将PDF转换为图片列表"""
    try:
        from pdf2image import convert_from_path
        return convert_from_path(pdf_path)
    except ImportError:
        print("请安装 pdf2image 和 poppler:", file=sys.stderr)
        print("  pip install pdf2image", file=sys.stderr)
        print("  macOS: brew install poppler", file=sys.stderr)
        print("  Ubuntu: sudo apt-get install poppler-utils", file=sys.stderr)
        sys.exit(1)

def ocr_page(image, engine='paddle', lang='ch'):
    """对单张图片进行OCR"""
    if engine == 'paddle':
        from paddleocr import PaddleOCR
        ocr = PaddleOCR(use_angle_cls=True, lang=lang)
        result = ocr.ocr(image, cls=True)
        lines = [line[1][0] for line in result[0]]
        return '\n'.join(lines)
    elif engine == 'tesseract':
        import pytesseract
        return pytesseract.image_to_string(image, lang=lang)
    elif engine == 'easyocr':
        import easyocr
        reader = easyocr.Reader(['ch_sim', 'en'])
        result = reader.readtext(image)
        return '\n'.join([line[1] for line in result])

def main():
    parser = argparse.ArgumentParser(description='OCR PDF文档识别')
    parser.add_argument('input', help='输入PDF路径')
    parser.add_argument('-o', '--output', help='输出文件路径 (可选)')
    parser.add_argument('-f', '--format', choices=['plain', 'json', 'markdown'],
                        default='plain', help='输出格式')
    parser.add_argument('-e', '--engine', choices=['paddle', 'tesseract', 'easyocr'],
                        default='paddle', help='OCR引擎')
    parser.add_argument('-l', '--lang', default='ch', help='语言代码')
    parser.add_argument('--dpi', type=int, default=200, help='PDF转图片的DPI')

    args = parser.parse_args()

    print(f"正在处理: {args.input}")
    images = pdf_to_images(args.input)
    print(f"共 {len(images)} 页")

    all_results = []
    for i, image in enumerate(images, 1):
        print(f"正在识别第 {i}/{len(images)} 页...")
        text = ocr_page(image, args.engine, args.lang)

        if args.format == 'json':
            all_results.append({'page': i, 'text': text})
        else:
            all_results.append(f"--- 第 {i} 页 ---\n{text}")

    # 输出结果
    if args.format == 'json':
        output = json.dumps(all_results, ensure_ascii=False, indent=2)
    else:
        output = '\n\n'.join(all_results)

    if args.output:
        Path(args.output).write_text(output, encoding='utf-8')
        print(f"\n结果已保存到: {args.output}")
    else:
        print(output)

if __name__ == '__main__':
    main()
