# Split Time Lower Third (mass start) Template

A lower third graphic template that displays live split time results for mass start races, showing the leader and the bottom runners.

## Features

- **Real-time Split Time Results**: Displays the current standings at a selected control point
- **Leader Tracking**: The current leader (position 1 at the split) is highlighted with green background
- **Bottom Runners Display**: Shows the leader plus the 4 bottom runners (last 4 positions)
- **Automatic Updates**: Polls the LiveResults API every 3 seconds for updated standings
- **Smooth Animations**: Runners slide in from the right with sequential timing
- **Dynamic Updates**: Automatically refreshes to show current leader and bottom 4 runners

## Display Behavior

### Initial State
- Shows the header with class name and control point name
- Displays the leader and the 4 bottom runners at the selected control

### Position Display
1. **Leader Row** (Position 1):
   - Highlighted with special styling (green background on time)
   - Shows the runner currently in 1st place at this control
   - Updates if a different runner takes the lead

2. **Bottom 4 Runners**:
   - Shows the last 4 positions (e.g., if there are 20 runners, shows positions 17-20)
   - Useful for mass start races to see who is struggling
   - Updates automatically when positions change

### Maximum Display
- **1 Leader row** (position 1 at this split)
- **4 Bottom runner rows** (last 4 positions at this split)
- **Total: 5 rows maximum**

## Configuration

### Data Source
- **Provider**: LiveResults API
- **Class Selector**: Choose which class to monitor
- **Control Point Selector**: Choose which split control to monitor (Finish is excluded)

### Auto-Update
- **Default**: Enabled
- **Interval**: 3000ms (3 seconds)
- Automatically polls for new passings and updates the display

## Data Format

The template expects OGRAF-formatted split time data:

```json
{
  "className": "M21",
  "controlCode": "99",
  "controlName": "Control 99",
  "results": [
    {
      "position": "1",
      "name": "Runner Name",
      "club": "Club Name",
      "time": "12:34",
      "diff": "",
      "status": "OK",
      "statusCode": 0
    }
  ]
}
```

## Styling

The template uses the same color scheme as the Full Screen Runners List template:
- **Header Background**: #B14340 (red)
- **Leader Time Background**: #89B6A5 (green)
- **Regular Time Background**: #548889 (teal)
- **Text Color**: #301525 (dark purple)

## Technical Details

### OGRAF Lifecycle Methods
- `load(options)`: Initialize with data and process updates
- `dispose()`: Clean up state
- `playAction(options)`: Animate in the graphic
- `stopAction(options)`: Animate out the graphic

### State Management
- Tracks seen runners to identify new passings
- Maintains leader separately from recent passings
- Automatically manages the 5-row limit

### Animations
- **Container**: Fades in/out (0.4s)
- **Header**: Slides up from bottom (0.5s)
- **Runners**: Slide in from right (0.4s)
- **Passings Out**: Slide out to left (0.3s)

## Usage

1. Add the template to a rundown item
2. Configure the data source:
   - Select a class
   - Select a split control point
3. Play the template
4. The template will automatically update as runners pass the control point

## Files

- `graphic.js`: Web Component implementation
- `split-time-lower-third.ograf.json`: Template manifest
- `split-time-lower-third.datasource.json`: Data source configuration
- `README.md`: This documentation

## Notes

- The template only shows split controls (not Finish) since it's designed for mid-race standings
- Shows the leader (position 1) and the bottom 4 runners (last 4 positions)
- Useful for mass start races to monitor both the leader and struggling runners
- The leader (position 1) is always visible and highlighted with green background
- Auto-update is enabled by default to ensure real-time display of current standings
- This is a single-step graphic (no "Next Step" button)
- The display refreshes completely on each update to show current leader and bottom 4

