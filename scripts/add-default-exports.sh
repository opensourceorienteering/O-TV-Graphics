#!/bin/bash
# Add default exports to all graphic.js files to comply with OGRAF specification
# The OGRAF spec requires the main graphic module to export the class as default export

set -e

echo "Adding default exports to all graphic.js files..."

# Function to add export to a file
add_export() {
  local template=$1
  local class_name=$2
  local file="templates/${template}/graphic.js"

  if [ -f "$file" ]; then
    echo "Processing $file..."

    # Check if export default already exists
    if grep -q "^export default ${class_name};" "$file"; then
      echo "  ⚠ Export already exists, skipping"
      return
    fi

    # Use awk to insert the export statement after the class closing brace
    # and before the "// Register the custom element" comment
    awk -v class_name="$class_name" '
      /^\/\/ Register the custom element/ {
        if (!exported) {
          print ""
          print "// Export the class as default export (required by OGRAF spec)"
          print "export default " class_name ";"
          print ""
          exported = 1
        }
      }
      { print }
    ' "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"

    echo "  ✓ Added export default ${class_name}"
  else
    echo "  ✗ File not found: $file"
  fi
}

# Add exports to all templates
add_export "general-lower-third" "GeneralLowerThird"
add_export "individual-results-control" "IndividualResultsControl"
add_export "individual-results-finish" "IndividualResultsFinish"
add_export "individual-runner-lower-third" "IndividualRunnerLowerThird"
add_export "individual-split-times-focused" "IndividualSplitTimesFocused"
add_export "individual-split-times" "IndividualSplitTimes"
add_export "individual-start-list" "IndividualStartList"
add_export "relay-results-finish" "RelayResultsFinish"
add_export "relay-results-leg-control" "RelayResultsLegControl"
add_export "relay-results-leg" "RelayResultsLeg"
add_export "relay-runner-lower-third" "RelayRunnerLowerThird"
add_export "relay-split-times-focused" "RelaySplitTimesFocused"
add_export "relay-split-times" "RelaySplitTimes"
add_export "relay-start-list" "RelayStartList"
add_export "relay-team-lower-third" "RelayTeamLowerThird"

echo ""
echo "✅ All graphic.js files have been updated with default exports!"

