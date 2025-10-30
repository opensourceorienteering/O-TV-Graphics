#!/bin/bash
# Fix custom element registration to prevent duplicate registration errors
# This script adds a check before customElements.define() to prevent conflicts

set -e

echo "Fixing custom element registration in all graphic.js files..."

# Array of template directories
templates=(
  "general-lower-third"
  "individual-results-control"
  "individual-results-finish"
  "individual-runner-lower-third"
  "individual-split-times-focused"
  "individual-split-times"
  "individual-start-list"
  "relay-results-finish"
  "relay-results-leg-control"
  "relay-results-leg"
  "relay-runner-lower-third"
  "relay-split-times-focused"
  "relay-split-times"
  "relay-start-list"
  "relay-team-lower-third"
)

for template in "${templates[@]}"; do
  file="templates/${template}/graphic.js"
  
  if [ -f "$file" ]; then
    echo "Processing $file..."
    
    # Use sed to replace the customElements.define line with a conditional check
    # This prevents "DOMException: Failed to execute 'define' on 'CustomElementRegistry': the name has already been used"
    sed -i '' "s/^customElements\.define('\([^']*\)', \([^)]*\));$/if (!customElements.get('\1')) {\n  customElements.define('\1', \2);\n}/" "$file"
    
    echo "  ✓ Fixed $template"
  else
    echo "  ✗ File not found: $file"
  fi
done

echo ""
echo "✅ All graphic.js files have been updated with duplicate registration protection!"

