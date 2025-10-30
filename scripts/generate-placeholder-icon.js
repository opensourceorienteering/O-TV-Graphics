#!/usr/bin/env node

/**
 * Generate Placeholder Icon for OL-Grafik
 * Creates a simple SVG-based icon that can be converted to required formats
 */

const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, '..', 'build');

// Ensure build directory exists
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Create SVG icon (1024x1024)
const svgIcon = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <!-- Background gradient -->
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#FF6B35;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#F7931E;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="controlGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#FFFFFF;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#E0E0E0;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Background circle -->
  <circle cx="512" cy="512" r="480" fill="url(#bgGradient)" />
  
  <!-- Orienteering control marker (simplified) -->
  <g transform="translate(512, 512)">
    <!-- Outer circle -->
    <circle cx="0" cy="0" r="280" fill="none" stroke="url(#controlGradient)" stroke-width="40" />
    
    <!-- Inner triangle (pointing up) -->
    <path d="M 0,-200 L 173,100 L -173,100 Z" fill="url(#controlGradient)" />
    
    <!-- Small circle in center -->
    <circle cx="0" cy="-30" r="50" fill="url(#bgGradient)" />
  </g>
  
  <!-- Text "OL" at bottom -->
  <text x="512" y="900" font-family="Arial, sans-serif" font-size="180" font-weight="bold" 
        text-anchor="middle" fill="#FFFFFF">OL</text>
</svg>`;

// Save SVG
const svgPath = path.join(buildDir, 'icon.svg');
fs.writeFileSync(svgPath, svgIcon);
console.log('✅ Created SVG icon:', svgPath);

// Create a simple README in build directory
const readme = `# OL-Grafik App Icons

This directory contains the application icons for OL-Grafik.

## Current Status

- ✅ icon.svg - SVG source file (placeholder)
- 🔄 icon.icns - macOS icon (needs to be generated)
- 🔄 icon.ico - Windows icon (needs to be generated)
- 🔄 icon.png - Linux icon (needs to be generated)

## How to Generate Icons

### Option 1: Online Converter (Easiest)
1. Upload icon.svg to https://cloudconvert.com/
2. Convert to:
   - ICNS (for macOS)
   - ICO (for Windows)
   - PNG 1024x1024 (for Linux)
3. Download and place in this directory

### Option 2: Using ImageMagick
\`\`\`bash
# Install ImageMagick
brew install imagemagick

# Convert SVG to PNG
convert icon.svg -resize 1024x1024 icon.png

# Convert PNG to ICO (Windows)
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
\`\`\`

### Option 3: Using iconutil (macOS .icns)
See APP_BRANDING_UPDATE.md for detailed instructions.

## Custom Icon Design

The current icon is a placeholder. For a professional look:
1. Design a custom 1024x1024 icon
2. Use orienteering themes (control markers, compass, etc.)
3. Convert to all required formats
4. Replace files in this directory

## Testing

After generating icons, rebuild the app:
\`\`\`bash
npm run build
\`\`\`

Check the built app in \`release/1.0.0/\` to verify icons appear correctly.
`;

const readmePath = path.join(buildDir, 'README.md');
fs.writeFileSync(readmePath, readme);
console.log('✅ Created README:', readmePath);

console.log('\n📋 Next Steps:');
console.log('1. Convert icon.svg to required formats:');
console.log('   - icon.icns (macOS)');
console.log('   - icon.ico (Windows)');
console.log('   - icon.png (Linux)');
console.log('\n2. Use online converter: https://cloudconvert.com/svg-to-icns');
console.log('   Or use ImageMagick/iconutil (see APP_BRANDING_UPDATE.md)');
console.log('\n3. Place generated icons in build/ directory');
console.log('\n4. Run: npm run build');
console.log('\n✨ Placeholder SVG icon created successfully!');

