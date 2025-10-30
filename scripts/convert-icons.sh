#!/bin/bash

# Convert OL-Grafik Icons
# Converts SVG icon to all required formats for Electron Builder

set -e

echo "🎨 Converting OL-Grafik icons..."

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick not found. Please install it:"
    echo "   brew install imagemagick"
    exit 1
fi

# Check if sips is available (macOS only)
if ! command -v sips &> /dev/null; then
    echo "⚠️  sips not found (macOS only). Will skip .icns generation."
    SKIP_ICNS=true
else
    SKIP_ICNS=false
fi

# Paths
BUILD_DIR="build"
SVG_ICON="$BUILD_DIR/icon.svg"
PNG_1024="$BUILD_DIR/icon-1024.png"
PNG_512="$BUILD_DIR/icon.png"
ICO_FILE="$BUILD_DIR/icon.ico"
ICNS_FILE="$BUILD_DIR/icon.icns"
ICONSET_DIR="$BUILD_DIR/icon.iconset"

# Check if SVG exists
if [ ! -f "$SVG_ICON" ]; then
    echo "❌ SVG icon not found: $SVG_ICON"
    echo "   Run: node scripts/generate-placeholder-icon.js"
    exit 1
fi

echo "📁 Source: $SVG_ICON"

# 1. Convert SVG to PNG (1024x1024)
echo "🔄 Converting SVG to PNG (1024x1024)..."
convert "$SVG_ICON" -resize 1024x1024 -background none "$PNG_1024"
echo "✅ Created: $PNG_1024"

# 2. Create 512x512 PNG for Linux
echo "🔄 Creating PNG for Linux (512x512)..."
convert "$PNG_1024" -resize 512x512 "$PNG_512"
echo "✅ Created: $PNG_512"

# 3. Create ICO for Windows
echo "🔄 Creating ICO for Windows..."
convert "$PNG_1024" -define icon:auto-resize=256,128,64,48,32,16 "$ICO_FILE"
echo "✅ Created: $ICO_FILE"

# 4. Create ICNS for macOS (if sips is available)
if [ "$SKIP_ICNS" = false ]; then
    echo "🔄 Creating ICNS for macOS..."
    
    # Create iconset directory
    mkdir -p "$ICONSET_DIR"
    
    # Generate all required sizes
    sips -z 16 16     "$PNG_1024" --out "$ICONSET_DIR/icon_16x16.png" > /dev/null 2>&1
    sips -z 32 32     "$PNG_1024" --out "$ICONSET_DIR/icon_16x16@2x.png" > /dev/null 2>&1
    sips -z 32 32     "$PNG_1024" --out "$ICONSET_DIR/icon_32x32.png" > /dev/null 2>&1
    sips -z 64 64     "$PNG_1024" --out "$ICONSET_DIR/icon_32x32@2x.png" > /dev/null 2>&1
    sips -z 128 128   "$PNG_1024" --out "$ICONSET_DIR/icon_128x128.png" > /dev/null 2>&1
    sips -z 256 256   "$PNG_1024" --out "$ICONSET_DIR/icon_128x128@2x.png" > /dev/null 2>&1
    sips -z 256 256   "$PNG_1024" --out "$ICONSET_DIR/icon_256x256.png" > /dev/null 2>&1
    sips -z 512 512   "$PNG_1024" --out "$ICONSET_DIR/icon_256x256@2x.png" > /dev/null 2>&1
    sips -z 512 512   "$PNG_1024" --out "$ICONSET_DIR/icon_512x512.png" > /dev/null 2>&1
    sips -z 1024 1024 "$PNG_1024" --out "$ICONSET_DIR/icon_512x512@2x.png" > /dev/null 2>&1
    
    # Convert to ICNS
    iconutil -c icns "$ICONSET_DIR" -o "$ICNS_FILE"
    
    # Clean up iconset directory
    rm -rf "$ICONSET_DIR"
    
    echo "✅ Created: $ICNS_FILE"
else
    echo "⚠️  Skipped ICNS generation (macOS only)"
fi

echo ""
echo "✨ Icon conversion complete!"
echo ""
echo "📦 Generated files:"
echo "   - $PNG_1024 (source PNG)"
echo "   - $PNG_512 (Linux)"
echo "   - $ICO_FILE (Windows)"
if [ "$SKIP_ICNS" = false ]; then
    echo "   - $ICNS_FILE (macOS)"
fi
echo ""
echo "🚀 Next step: npm run build"

