#!/bin/bash
# count-hardcoded-colors.sh
# 남은 하드코딩 색상 개수 확인
# Usage: bash count-hardcoded-colors.sh

echo "=== Hardcoded Color Count ==="
echo ""

# HTML/CSS 파일 색상 개수
html_css_count=$(grep -rE '#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}(?![0-9A-Fa-f])' *.html css/*.css 2>/dev/null | grep -v theme.css | wc -l)

# JS 파일 색상 개수 (sprites 제외)
js_ui_count=$(grep -rE '#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}(?![0-9A-Fa-f])' js/horse-race.js 2>/dev/null | wc -l)

# Sprite 파일 색상 개수 (변경 불가 - SVG 정적 자산)
sprite_count=$(grep -rE '#[0-9A-Fa-f]{6}' js/horse-race-sprites.js 2>/dev/null | wc -l)

ui_total=$((html_css_count + js_ui_count))

echo "HTML/CSS:     $html_css_count / 691"
echo "JS (UI):      $js_ui_count / 78"
echo "SVG Sprites:  $sprite_count (excluded - static asset)"
echo ""
echo "UI Total:     $ui_total / 769"
echo "Progress:     $(( (769 - ui_total) * 100 / 769 ))% complete"
echo ""

if [ $ui_total -eq 0 ]; then
  echo "✅ All UI hardcoded colors removed!"
  echo "ℹ️  SVG sprite colors ($sprite_count) kept as-is (static visual assets)"
else
  echo "📊 Breakdown by file:"
  echo ""
  echo "=== HTML/CSS Files ==="
  grep -rE '#[0-9A-Fa-f]{6}' *.html css/*.css 2>/dev/null | grep -v theme.css | cut -d: -f1 | sort | uniq -c | sort -rn
  echo ""
  echo "=== JS UI Files ==="
  grep -rE '#[0-9A-Fa-f]{6}' js/horse-race.js 2>/dev/null | cut -d: -f1 | sort | uniq -c | sort -rn
  echo ""
  echo "=== SVG Sprites (Excluded) ==="
  echo "    $sprite_count js/horse-race-sprites.js (static asset - unchanged)"
fi
