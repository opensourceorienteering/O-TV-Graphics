# Countdown/Countup Timer Template

A clean, upper-right corner timer graphic that counts down to a target time and automatically switches to count-up mode when the target is reached.

## Features

- **Dual Mode Operation**: Automatically switches between countdown and countup modes
- **Real-time Updates**: Timer updates every second with precise time calculations
- **Live Reconfiguration**: Target time can be updated while the graphic is on-air
- **Visual Feedback**: Color changes when switching from countdown (teal) to countup (green)
- **Clean Design**: Simple, readable display positioned in the upper right corner
- **Smooth Animations**: Fades in/out with subtle slide animation

## Display Behavior

### Countdown Mode (Before Target Time)
- **Timer Background**: Teal (#548889)
- **Display**: Shows time remaining until target time (HH:MM:SS)
- **Updates**: Every second, counting down

### Countup Mode (After Target Time)
- **Timer Background**: Green (#89B6A5)
- **Display**: Shows time elapsed since target time (HH:MM:SS)
- **Updates**: Every second, counting up
- **Automatic Switch**: Transitions smoothly when countdown reaches 00:00:00

### Position
- **Location**: Upper right corner of the screen
- **Offset**: 40px from top and right edges
- **Size**: Compact (280px minimum width)

## Configuration

### Required Inputs

1. **Title** (string)
   - Label text displayed above the timer
   - Examples: "Race Start", "Next Wave", "Finish Closes"
   - Displayed in red header bar

2. **Target Time** (string, format: HH:MM:SS)
   - The time to count down to (or count up from)
   - Format: `HH:MM:SS` (24-hour format)
   - Examples: `"11:30:00"`, `"14:45:30"`, `"09:00:00"`
   - Validation: Must match pattern `^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$`
   - Interpreted as today's date

### Example Configuration

```json
{
  "title": "Race Start",
  "targetTime": "11:30:00"
}
```

## Usage

### Basic Workflow

1. **Add Template to Rundown**
   - Add the "Countdown/Countup Timer" template to a rundown item

2. **Configure Inputs**
   - Set the **Title** (e.g., "Race Start")
   - Set the **Target Time** in HH:MM:SS format (e.g., "11:30:00")

3. **Play the Graphic**
   - Click "On Air" to display the timer
   - Timer will automatically start updating every second
   - Color will change from teal to green when target time is reached

4. **Update While On-Air** (Optional)
   - You can change the target time while the graphic is on-air
   - The timer will immediately recalculate and update

5. **Take Off-Air**
   - Click "Off Air" to hide the timer
   - Timer stops updating when off-air

## Technical Details

### OGRAF Lifecycle Methods

- **`load(options)`**: Initialize with title and target time, parse time, render display
- **`playAction(options)`**: Fade in the graphic and start the timer interval
- **`stopAction(options)`**: Fade out the graphic and stop the timer interval
- **`dispose()`**: Clean up timer interval and resources

### Timer Logic

1. **Initialization**
   - Parse target time string (HH:MM:SS)
   - Create a Date object for today with the specified time
   - Calculate initial time difference

2. **Update Cycle** (Every Second)
   - Get current time
   - Calculate difference: `targetDate - now`
   - If difference > 0: Countdown mode (show time remaining)
   - If difference ≤ 0: Countup mode (show time elapsed)
   - Update display with formatted time (HH:MM:SS)
   - Update background color based on mode

3. **Mode Switching**
   - Automatic transition when countdown reaches 00:00:00
   - Smooth color change from teal to green
   - No interruption in timer updates

### Time Interpretation

- Target time is interpreted as **today's date**
- If the target time has already passed today, the timer starts in countup mode
- If the target time is in the future today, the timer starts in countdown mode

### Styling

- **Font**: Inter (same as other OL-Grafik templates)
- **Header Background**: #B14340 (red)
- **Countdown Timer**: #548889 (teal)
- **Countup Timer**: #89B6A5 (green)
- **Text Color**: White on colored backgrounds
- **Border Radius**: 8px for rounded corners
- **Shadow**: Subtle drop shadow for depth

## Files

- `graphic.js`: Web Component implementation with timer logic
- `countdown-timer.ograf.json`: EBU OGRAF v1 manifest
- `README.md`: This documentation

## EBU OGRAF v1 Compliance

This template follows the EBU OGRAF v1 specification:

- ✅ Valid `$schema` reference
- ✅ Unique `id`: `countdown-timer`
- ✅ Semantic versioning: `1.0.0`
- ✅ JSON Schema validation for inputs
- ✅ Required fields: `title`, `targetTime`
- ✅ Pattern validation for time format
- ✅ Implements all required lifecycle methods
- ✅ Returns proper status codes and messages
- ✅ Single-step graphic (`stepCount: 1`)
- ✅ Real-time support only (`supportsRealTime: true`)

## Use Cases

### Race Start Countdown
```json
{
  "title": "Race Start",
  "targetTime": "11:00:00"
}
```
Shows countdown to race start, then counts up to show elapsed race time.

### Wave Start Timer
```json
{
  "title": "Wave 2 Start",
  "targetTime": "11:05:00"
}
```
Countdown to next wave start time.

### Finish Closure
```json
{
  "title": "Finish Closes",
  "targetTime": "15:30:00"
}
```
Shows time remaining until finish line closes.

### Time Control
```json
{
  "title": "Time Limit",
  "targetTime": "14:00:00"
}
```
Countdown to a time control deadline.

## Notes

- Timer updates are paused when the graphic is off-air to conserve resources
- Timer automatically resumes when brought back on-air
- The timer uses `setInterval` with 1-second precision
- Time calculations are based on the system clock
- No date component - all times are interpreted as today
- The graphic is designed to be non-intrusive in the upper right corner
- Suitable for long-duration display during broadcasts
- Can be used alongside other graphics (positioned to avoid overlap)

## Limitations

- Time is interpreted as today only (no cross-day support)
- 1-second update precision (not sub-second)
- Requires accurate system clock on the broadcast machine
- No timezone support (uses local system time)
- Single-step graphic (no multi-step animations)

## Future Enhancements

Potential improvements for future versions:
- Date component for multi-day events
- Configurable colors and styling
- Sound alerts at specific intervals
- Millisecond precision option
- Multiple timer presets
- Timezone support

