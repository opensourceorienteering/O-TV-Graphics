# Split Time Lower Third (Runner) Template

A lower third graphic template for tracking a specific runner's progress at a selected control point with dynamic positioning and live timing before split time is received.

## Features

- **Runner-Specific Tracking**: Select and track a specific runner by name or bib number
- **Live Timing**: Shows calculated/estimated time before split time is received from API
  - For Start control: Countdown to start, then count up from start
  - For other controls: Count up from start time
- **Dynamic Positioning**: Display adjusts based on runner's current position
- **Smart Display Logic**: Shows leader + selected runner + relevant competitors
- **Automatic Updates**: Polls the LiveResults API every 1 second for real-time updates
- **Visual Indicators**: Different styling for live timing vs confirmed times

## Display Behavior

### Runner Selection
- Operator selects a class, control point, and specific runner
- Runner can be searched by name or bib number
- Template tracks only the selected runner's progress

### Live Timing (Before Split Time Received)

**For Start Control:**
1. **Before start time**: Shows countdown (e.g., "-00:05" = 5 seconds until start)
2. **After start time**: Shows count up from 00:00
3. **Styling**: Red background with pulsing animation

**For Other Controls (Splits/Finish):**
1. **Calculation**: Time counts up from runner's start time
2. **Position**: Estimated based on current time vs other runners
3. **Styling**: Red background with pulsing animation
4. **Updates**: Refreshes every 100ms for smooth display

### After Split Time Received

1. **Time**: Switches to exact time from API
2. **Position**: Uses confirmed position from API
3. **Styling**: 
   - Position 1: Green background (leader styling)
   - Other positions: Teal background (normal styling)
4. **Animation**: Pulsing stops

### Dynamic Row Positioning

The template displays 5 runner rows with dynamic positioning:

**Case 1: Selected Runner is Leader (Position 1)**
- Row 1: Selected runner (green background if confirmed, red if live timing)
- Row 2-5: Positions 2-5 (normal styling)

**Case 2: Selected Runner is NOT Leader**
- Row 1: Current leader (green background)
- Row 2: Selected runner (red if live timing, teal if confirmed)
- Row 3-5: Next 3 runners behind selected runner

**Example:** If selected runner is in position 5 out of 20:
- Row 1: Leader (position 1) - green background
- Row 2: Selected runner (position 5) - red background (live) or teal (confirmed)
- Row 3: Runner in position 6
- Row 4: Runner in position 7
- Row 5: Runner in position 8

This allows the operator to see who the selected runner is competing against in real-time.

## Configuration

### Data Source
- **Provider**: LiveResults API
- **Class Selector**: Choose which class to monitor
- **Control Point Selector**: Choose which control to track (including Start and Finish)
- **Runner Search**: Search for a specific runner by name or bib number

### Auto-Update
- **Default**: Enabled
- **Interval**: 1000ms (1 second)
- Automatically polls for new data and updates the display
- Live timing updates every 100ms for smooth countdown/countup

## Data Format

The template expects OGRAF-formatted split time data with runner information:

```json
{
  "className": "M21",
  "controlCode": "99",
  "controlName": "Control 99",
  "runnerId": "12345",
  "runnerName": "John Smith",
  "runnerBib": "101",
  "runnerClub": "OK Linné",
  "results": [
    {
      "position": "1",
      "name": "John Smith",
      "club": "OK Linné",
      "bib": "101",
      "time": "12:34",
      "diff": "",
      "status": "OK",
      "statusCode": 0,
      "startTime": "10:00:00"
    }
  ]
}
```

## Styling

The template uses three distinct styling states:

### 1. Live Timing (Before API Confirmation)
- **Background**: Red (#B14340) with pulsing animation
- **Purpose**: Indicates calculated/estimated time
- **Animation**: Pulses between 100% and 70% opacity

### 2. Leader (Position 1, After API Confirmation)
- **Background**: Green (#89B6A5)
- **Text Color**: Dark purple (#301525)
- **Purpose**: Highlights the leader

### 3. Normal (Position 2+, After API Confirmation)
- **Background**: Teal (#548889)
- **Text Color**: White
- **Purpose**: Standard runner display

### Other Elements
- **Header Background**: Red (#B14340)
- **Container Gradient**: Teal radial gradient
- **Text Color**: Dark purple (#301525) for header, white for runners

## Technical Details

### OGRAF Lifecycle Methods
- `load(options)`: Initialize with data and start processing
- `dispose()`: Clean up state and stop live timing
- `playAction()`: Animate in the graphic and start live timing
- `stopAction()`: Animate out the graphic and stop live timing

### State Management
- Tracks selected runner separately from other runners
- Maintains live timing state and interval
- Calculates estimated position during live timing
- Updates display when position changes

### Animations
- **Container**: Fades in/out (0.4s)
- **Header**: Slides up from bottom (0.5s)
- **Runners**: Slide in from right (0.4s)
- **Live Timing**: Pulsing animation (1s cycle)
- **Drop Shadow**: Fades in after animations complete

### Live Timing Logic
- **Update Frequency**: Every 100ms for smooth display
- **Position Calculation**: Compares elapsed time with other runners' confirmed times
- **Automatic Transition**: Switches from live timing to confirmed time when API data arrives

## Usage

1. Add the template to a rundown item
2. Configure the data source:
   - Select a class
   - Select a control point (Start, split, or Finish)
   - Search for and select a specific runner
3. Play the template
4. The template will show live timing until split time is received
5. Display updates automatically as the runner's position changes

## Files

- `graphic.js`: Web Component implementation
- `split-time-lower-third-runner.ograf.json`: Template manifest
- `split-time-lower-third-runner.datasource.json`: Data source configuration
- `README.md`: This documentation

## Notes

- The template supports all control types (Start, splits, and Finish)
- Live timing provides real-time feedback before official split times arrive
- Position calculation is estimated during live timing and confirmed when API data arrives
- The display dynamically adjusts to show relevant competitors
- Auto-update interval is 1 second to balance responsiveness with API load
- Live timing updates every 100ms for smooth countdown/countup display
- This is a single-step graphic (no "Next Step" button)

