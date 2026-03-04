#!/usr/bin/env python3
"""
Batch OCR Script - 批量识别多个图片或PDF文件
"""

import argparse
import json
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# 导入OCR函数
sys.path.insert(0, str(Path(__file__).parent))
from ocr_image import ocr_with_paddle, ocr_with_tesseract, ocr_with_easyocr
from ocr_pdf import pdf_to_images, ocr_page

def process_file(file_path, engine='paddle', lang='ch'):
    """处理单个文件"""
    path = Path(file_path)
    suffix = path.suffix.lower()

    try:
        if suffix == '.pdf':
            images = pdf_to_images(file_path)
            pages = []
            for i, image in enumerate(images, 1):
                text = ocr_page(image, engine, lang)
                pages.append(f"--- Page {i} ---\n{text}")
            return {'file': str(path), 'success': True, 'text': '\n\n'.join(pages)}
        else:
            if engine == 'paddle':
                text = ocr_with_paddle(file_path, lang, 'plain')
            elif engine == 'tesseract':
                text = ocr_with_tesseract(file_path, lang, 'plain')
            elif engine == 'easyocr':
                text = ocr_with_easyocr(file_path, ['ch_sim', 'en'], 'plain')
            return {'file': str(path), 'success': True, 'text': text}
    except Exception as e:
        return {'file': str(path), 'success': False, 'error': str(e)}

def main():
    parser = argparse.ArgumentParser(description='批量OCR识别')
    parser.add_argument('inputs', nargs='+', help='输入文件或目录')
    parser.add_argument('-o', '--output-dir', help='输出目录 (默认为当前目录)')
    parser.add_argument('-e', '--engine', choices=['paddle', 'tesseract', 'easyocr'],
                        default='paddle', help='OCR引擎')
    parser.add_argument('-l', '--lang', default='ch', help='语言代码')
    parser.add_argument('--json', action='store_true', help='输出JSON汇总')
    parser.add_argument('-t', '--threads', type=int, default=4, help='并行线程数')

    args = parser.parse_args()

    # 收集所有文件
    files = []
    for item in args.inputs:
        path = Path(item)
        if path.is_dir():
            for ext in ['*.png', '*.jpg', '*.jpeg', '*.bmp', '*.tiff', '*.pdf']:
                files.extend(path.glob(ext))
        else:
            files.append(path)

    if not files:
        print("未找到需要处理的文件")
        sys.exit(1)

    print(f"找到 {len(files)} 个文件待处理")

    # 并行处理
    results = []
    with ThreadPoolExecutor(max_workers=args.threads) as executor:
        futures = {executor.submit(process_file, f, args.engine, args.lang): f for f in files}
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            status = "✓" if result['success'] else "✗"
            print(f"{status} {Path(result['file']).name}")

    # 输出结果
    if args.json:
        output = json.dumps(results, ensure_ascii=False, indent=2)
        if args.output_dir:
            output_path = Path(args.output_dir) / 'ocr_results.json'
            output_path.write_text(output, encoding='utf-8')
            print(f"\nJSON结果已保存到: {output_path}")
        else:
            print(output)
    else:
        if args.output_dir:
            output_dir = Path(args.output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
            for result in results:
                if result['success']:
                    input_name = Path(result['file']).stem
                    output_path = output_dir / f"{input_name}.txt"
                    output_path.write_text(result['text'], encoding='utf-8')
            print(f"\n结果已保存到: {output_dir}")
        else:
            for result in results:
                if result['success']:
                    print(f"\n--- {Path(result['file']).name} ---")
                    print(result['text'])

    # 统计
    success = sum(1 for r in results if r['success'])
    print(f"\n完成: {success}/{len(results)} 成功")

if __name__ == '__main__':
    main()
