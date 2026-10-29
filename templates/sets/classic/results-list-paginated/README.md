# Full Screen Runners List Template

Full-screen results list template with automatic multi-step pagination for OL-Grafik broadcast graphics.

## Features

- **Full-screen layout** with appropriate margins matching SMGraphics-example design
- **API-driven** - automatically fetches data from LiveResults API
- **Multi-step pagination** - automatically creates pages for 10 runners per page (optimized for mobile readability)
- **Operator controls:**
  - Class selector dropdown
  - Timing point selector (Finish or any control point)
- **Smart time display:**
  - Shows total time for 1st place (leader) on step 1, page 1 only
  - Shows time behind leader for all other runners
  - Intelligent time truncation: HH:MM:SS → MM:SS if < 1 hour, MM:SS → SS if < 1 minute
- **Runner status display:**
  - Shows status codes when status is not OK (DNS, DNF, MP, DSQ, OT, WO, etc.)
  - Displays time normally for OK status (0)
- **Leader highlighting:**
  - Special styling applied only to the first row of step 1, page 1 (the actual race leader)
  - Other pages show normal styling
- **Sequential animations:**
  - Title row animates in first
  - Runner rows animate in one by one
  - On page change: title stays, only runners animate
  - On stop: all elements animate out

## Usage

1. Add template to rundown in ProductionView
2. Select the class from the dropdown
3. Select timing point (defaults to "Finish")
4. Click Play to show first page (10 runners)
5. Click "Next Step" or press → to advance to next page
6. Click Stop to hide the graphic

## Data Format

The template expects OGRAF-formatted data from the LiveResults transformer:

```javascript
{
  className: "D21",
  controlCode: "F",  // or control number
  controlName: "Finish",  // or "Control 99"
  results: [
    {
      position: 1,
      name: "Runner Name",
      club: "Club Name",
      time: "1:30:12",
      diff: "",  // empty for leader
      status: "OK",
      statusCode: 0
    },
    {
      position: 2,
      name: "Runner Name 2",
      club: "Club Name 2",
      time: "1:30:55",
      diff: "+0:43",
      status: "OK",
      statusCode: 0
    },
    {
      position: 3,
      name: "Runner Name 3",
      club: "Club Name 3",
      time: "--:--",
      diff: "",
      status: "DNF",
      statusCode: 2  // Did Not Finish
    }
    // ... more runners
  ]
}
```

## Technical Details

- **Template ID:** `results-list-paginated`
- **OGRAF Version:** 1.0
- **Step Count:** 0 (auto-calculated based on results count)
- **Runners per page:** 10
- **Data Source:** LiveResults API
- **Auto-update:** Enabled (5 second interval)
- **Font size:** 24px base (increased from 20px for better mobile readability)
- **Runner row font size:** 1.375rem (increased from 1.125rem)

## Styling

Based on SMGraphics-example template styling:
- Background: Radial gradient overlay
- Header: Red (#B14340) with white text
- Leader row: Light green time background (#89B6A5)
- Other rows: Teal time background (#548889)
- Font: Inter, sans-serif
- Resolution: 1920x1080

## Files

- `results-list-paginated.ograf.json` - OGRAF manifest
- `results-list-paginated.datasource.json` - Data source configuration
- `graphic.js` - Web Component implementation
- `README.md` - This file

