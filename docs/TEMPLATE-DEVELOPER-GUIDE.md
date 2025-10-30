# Template Developer Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [OGRAF Manifest Structure](#ograf-manifest-structure)
4. [Template Lifecycle Methods](#template-lifecycle-methods)
5. [Multi-Step Graphics](#multi-step-graphics)
6. [Playback Modes](#playback-modes)
7. [Data Schema Definition](#data-schema-definition)
8. [Datasource Configuration](#datasource-configuration)
9. [HTML/CSS/JavaScript Structure](#htmlcssjavascript-structure)
10. [Testing Templates](#testing-templates)
11. [Complete Examples](#complete-examples)
12. [Best Practices](#best-practices)

---

## Introduction

OL-Grafik uses the **EBU OGRAF v1 specification** for broadcast graphics templates. OGRAF (Open Graphics Format) is a standardized format that enables interoperability between different broadcast graphics systems.

### What is a Template?

A template is a reusable graphics component that:
- Displays dynamic data (runner names, results, times, etc.)
- Supports animations (in/out transitions, step changes)
- Can be controlled via the production interface
- Integrates with external data sources (LiveResults API)

### File Structure

Each template consists of:

```
templates/
  └── my-template/
      ├── my-template.ograf.json          # OGRAF manifest (required)
      ├── my-template.datasource.json     # Datasource config (optional)
      ├── graphic.js                      # Web Component code (required)
      ├── css/                            # Stylesheets (optional)
      │   └── styles.css
      └── images/                         # Assets (optional)
          └── logo.png
```

**Naming Convention:**
- Template directory name: `kebab-case` (e.g., `runner-spotlight`)
- Manifest file: `{template-id}.ograf.json` (must match manifest `id` field)
- Datasource file: `{template-id}.datasource.json` (must match manifest `id` field)
- Main JavaScript: `graphic.js` (or as specified in manifest `main` field)

---

## Getting Started

### Creating Your First Template

1. **Create template directory:**
   ```bash
   mkdir templates/my-lower-third
   cd templates/my-lower-third
   ```

2. **Create OGRAF manifest** (`my-lower-third.ograf.json`):
   ```json
   {
     "$schema": "https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json",
     "id": "my-lower-third",
     "version": "1.0.0",
     "name": "My Lower Third",
     "description": "A simple lower third graphic",
     "author": {
       "name": "Your Name",
       "email": "your.email@example.com"
     },
     "main": "graphic.js",
     "schema": {
       "type": "object",
       "properties": {
         "name": {
           "type": "string",
           "title": "Name",
           "description": "Person's name"
         },
         "title": {
           "type": "string",
           "title": "Title",
           "description": "Person's title or role"
         }
       },
       "required": ["name"]
     },
     "supportsRealTime": true,
     "supportsNonRealTime": true,
     "stepCount": 1
   }
   ```

3. **Create Web Component** (`graphic.js`):
   ```javascript
   class MyLowerThird extends HTMLElement {
     constructor() {
       super();
       this.attachShadow({ mode: 'open' });
       this.data = {};
       this.currentStep = 0;
     }

     connectedCallback() {
       this.render();
     }

     render() {
       this.shadowRoot.innerHTML = `
         <style>
           .container {
             position: absolute;
             bottom: 100px;
             left: 50px;
             background: rgba(0, 0, 0, 0.8);
             color: white;
             padding: 20px;
             border-radius: 8px;
             opacity: 0;
             transform: translateX(-100%);
             transition: all 0.5s ease;
           }
           .container.visible {
             opacity: 1;
             transform: translateX(0);
           }
           .name {
             font-size: 32px;
             font-weight: bold;
             margin-bottom: 8px;
           }
           .title {
             font-size: 24px;
             color: #ccc;
           }
         </style>
         <div class="container">
           <div class="name">${this.data.name || ''}</div>
           <div class="title">${this.data.title || ''}</div>
         </div>
       `;
     }

     async playAction(options = {}) {
       const container = this.shadowRoot.querySelector('.container');
       if (container) {
         container.classList.add('visible');
       }
       this.currentStep = 1;
       return { statusCode: 200, message: 'Play action completed' };
     }

     async stopAction(options = {}) {
       const container = this.shadowRoot.querySelector('.container');
       if (container) {
         container.classList.remove('visible');
       }
       this.currentStep = 0;
       return { statusCode: 200, message: 'Stop action completed' };
     }

     async updateAction(options) {
       this.data = options.data;
       this.render();
       return { statusCode: 200, message: 'Update action completed' };
     }

     async customAction(options) {
       return { statusCode: 404, message: 'Custom action not supported' };
     }
   }

   customElements.define('my-lower-third', MyLowerThird);
   ```

4. **Test your template:**
   - Restart OL-Grafik
   - Open ProjectView
   - Your template should appear in the template list
   - Add it to a rundown and test in ProductionView

---

## OGRAF Manifest Structure

The OGRAF manifest (`.ograf.json`) defines template metadata and capabilities.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `$schema` | string | Must be `"https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json"` |
| `id` | string | Unique identifier (kebab-case, e.g., `"runner-spotlight"`) |
| `version` | string | Semantic version (e.g., `"1.0.0"`) |
| `name` | string | Human-readable name |
| `main` | string | Main JavaScript file (e.g., `"graphic.js"`) |
| `schema` | object | JSON Schema defining data fields |
| `supportsRealTime` | boolean | Supports live broadcast rendering |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Template description |
| `author` | object | Author info (`name`, `email`) |
| `supportsNonRealTime` | boolean | Supports post-production rendering |
| `stepCount` | number | Number of steps (0=auto, 1=single, >1=multi-step) |
| `playbackMode` | string | `"solo"` or `"stackable"` (deprecated, use per-item setting) |
| `customActions` | array | Custom actions supported by template |
| `renderRequirements` | array | Rendering requirements |

### Example Manifest

```json
{
  "$schema": "https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json",
  "id": "runner-spotlight",
  "version": "1.0.0",
  "name": "Runner Spotlight",
  "description": "Highlights a specific runner with their stats",
  "author": {
    "name": "TV-Grafik",
    "email": "info@tv-grafik.com"
  },
  "main": "graphic.js",
  "schema": {
    "type": "object",
    "properties": {
      "runnerName": {
        "type": "string",
        "title": "Runner Name"
      },
      "club": {
        "type": "string",
        "title": "Club"
      },
      "bibNumber": {
        "type": "string",
        "title": "Bib Number"
      }
    },
    "required": ["runnerName"]
  },
  "supportsRealTime": true,
  "supportsNonRealTime": true,
  "stepCount": 1
}
```

---

## Template Lifecycle Methods

OGRAF templates must implement four lifecycle methods as part of the Web Component.

### 1. playAction(options)

Called when the graphic should play (animate in or advance to next step).

**Parameters:**
```typescript
options: {
  skipAnimation?: boolean;  // Skip animations (instant display)
  delta?: number;           // Relative step change (for multi-step)
  goto?: number;            // Absolute step number (for multi-step)
  data?: any;               // Template data
}
```

**Returns:**
```typescript
{
  statusCode: number;       // 200 = success
  message: string;          // Status message
  currentStep?: number;     // Current step (for multi-step)
}
```

**Example:**
```javascript
async playAction(options = {}) {
  console.log('[MyTemplate] Play action', options);
  
  const skipAnimation = options.skipAnimation || false;
  const container = this.shadowRoot.querySelector('.container');
  
  if (container) {
    if (skipAnimation) {
      container.classList.add('visible');
    } else {
      await this.animateIn();
      container.classList.add('visible');
    }
  }
  
  this.currentStep = 1;
  
  return {
    statusCode: 200,
    message: 'Play action completed',
    currentStep: this.currentStep
  };
}
```

### 2. stopAction(options)

Called when the graphic should stop (animate out).

**Parameters:**
```typescript
options: {
  skipAnimation?: boolean;  // Skip animations (instant hide)
}
```

**Returns:**
```typescript
{
  statusCode: number;       // 200 = success
  message: string;          // Status message
}
```

**Example:**
```javascript
async stopAction(options = {}) {
  console.log('[MyTemplate] Stop action', options);
  
  const skipAnimation = options.skipAnimation || false;
  const container = this.shadowRoot.querySelector('.container');
  
  if (container) {
    if (skipAnimation) {
      container.classList.remove('visible');
    } else {
      await this.animateOut();
      container.classList.remove('visible');
    }
  }
  
  this.currentStep = 0;
  
  return {
    statusCode: 200,
    message: 'Stop action completed'
  };
}
```

### 3. updateAction(options)

Called when the graphic's data should be updated (while already playing).

**Parameters:**
```typescript
options: {
  data: any;                // New template data
}
```

**Returns:**
```typescript
{
  statusCode: number;       // 200 = success
  message: string;          // Status message
}
```

**Example:**
```javascript
async updateAction(options) {
  console.log('[MyTemplate] Update action', options);

  this.data = options.data;
  this.render();

  // Optional: trigger update animation
  const graphic = this.shadowRoot.querySelector('.graphic');
  if (graphic) {
    graphic.classList.add('updating');
    setTimeout(() => {
      graphic.classList.remove('updating');
    }, 600);
  }

  return {
    statusCode: 200,
    message: 'Update action completed'
  };
}
```

### 4. customAction(options)

Called for custom template-specific actions.

**Parameters:**
```typescript
options: {
  action: string;           // Custom action name
  [key: string]: any;       // Custom parameters
}
```

**Returns:**
```typescript
{
  statusCode: number;       // 200 = success, 404 = not supported
  message: string;          // Status message
}
```

**Example:**
```javascript
async customAction(options) {
  console.log('[MyTemplate] Custom action', options);

  // Most templates don't need custom actions
  return {
    statusCode: 404,
    message: 'Custom action not supported'
  };
}
```

---

## Multi-Step Graphics

Multi-step graphics allow a single template to display multiple states or steps (e.g., a lower third that expands to show more information).

### Configuring Multi-Step

Set `stepCount` in the manifest:

```json
{
  "stepCount": 3  // This template has 3 steps
}
```

**stepCount values:**
- `0` = Auto-detect (not recommended)
- `1` = Single-step graphic (default)
- `>1` = Multi-step graphic (e.g., 2, 3, 4)

### Implementing Multi-Step playAction

```javascript
async playAction(options = {}) {
  console.log('[MultiStepTemplate] Play action', options);

  const skipAnimation = options.skipAnimation || false;
  const delta = options.delta || 0;
  const goto = options.goto;

  // Determine target step
  let targetStep;
  if (goto !== undefined) {
    // Absolute step number (goto: 2 means go to step 2)
    targetStep = goto;
  } else if (delta !== 0) {
    // Relative step change (delta: 1 means next step, delta: -1 means previous)
    targetStep = this.currentStep + delta;
  } else {
    // Initial play - go to step 1
    targetStep = this.currentStep === 0 ? 1 : this.currentStep;
  }

  // Clamp to valid range
  targetStep = Math.max(1, Math.min(targetStep, 3)); // 3 = stepCount

  // Apply step
  const container = this.shadowRoot.querySelector('.container');
  if (container) {
    // Remove all step classes
    container.classList.remove('step-1', 'step-2', 'step-3');

    // Add target step class
    container.classList.add(`step-${targetStep}`);
    container.classList.add('visible');
  }

  this.currentStep = targetStep;

  return {
    statusCode: 200,
    message: 'Play action completed',
    currentStep: this.currentStep
  };
}
```

### CSS for Multi-Step

```css
.container {
  width: 400px;
  height: 100px;
  transition: all 0.5s ease;
}

/* Step 1: Basic info */
.container.step-1 {
  width: 400px;
}

/* Step 2: Expanded info */
.container.step-2 {
  width: 600px;
}

/* Step 3: Full info */
.container.step-3 {
  width: 800px;
}

.container.step-2 .extra-info,
.container.step-3 .extra-info {
  display: block;
}

.container.step-3 .full-stats {
  display: block;
}
```

### Using Multi-Step in Production

1. Add template to rundown
2. Click "Play" to show step 1
3. Click "Next Step" (or press ArrowRight) to advance to step 2
4. Click "Next Step" again to advance to step 3
5. Click "Stop" to hide the graphic

---

## Playback Modes

Playback modes control how templates interact with other playing graphics.

### Solo Mode

When a **solo** template is played, all other playing graphics are automatically stopped.

**Use cases:**
- Full-screen graphics (results tables, start lists)
- Graphics that should have exclusive focus
- Transitions between major segments

**Configuration:**

Per rundown item (recommended):
```typescript
// Set in ProductionView > Template Settings Panel
item.playbackMode = 'solo';
```

Per template (deprecated):
```json
{
  "playbackMode": "solo"
}
```

### Stackable Mode

**Stackable** templates can play alongside other graphics (default behavior).

**Use cases:**
- Lower thirds
- Bugs/logos
- Multiple simultaneous graphics

**Configuration:**

Per rundown item (recommended):
```typescript
item.playbackMode = 'stackable';
```

Per template (deprecated):
```json
{
  "playbackMode": "stackable"
}
```

### Priority Order

The system checks playback mode in this order:
1. Rundown item setting (highest priority)
2. Template manifest setting
3. Default to `'stackable'` (lowest priority)

**Best Practice:** Set playback mode per rundown item, not in the template manifest. This gives operators flexibility to use the same template in different ways.

---

## Data Schema Definition

The `schema` field in the manifest defines the template's data structure using JSON Schema.

### Basic Schema

```json
{
  "schema": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "title": "Name",
        "description": "Person's name",
        "default": "John Doe"
      },
      "age": {
        "type": "number",
        "title": "Age",
        "minimum": 0,
        "maximum": 120
      },
      "active": {
        "type": "boolean",
        "title": "Active",
        "default": true
      }
    },
    "required": ["name"]
  }
}
```

### Supported Types

| Type | Description | Example |
|------|-------------|---------|
| `string` | Text field | `"John Doe"` |
| `number` | Numeric field | `42` |
| `integer` | Integer field | `42` |
| `boolean` | Checkbox | `true` |
| `array` | List of items | `["item1", "item2"]` |
| `object` | Nested object | `{ "key": "value" }` |

### Field Properties

| Property | Description | Example |
|----------|-------------|---------|
| `title` | Display label | `"Runner Name"` |
| `description` | Help text | `"The runner's full name"` |
| `default` | Default value | `"Unknown"` |
| `enum` | Allowed values | `["H21", "D21", "H35"]` |
| `minimum` | Min value (numbers) | `0` |
| `maximum` | Max value (numbers) | `100` |
| `minLength` | Min length (strings) | `1` |
| `maxLength` | Max length (strings) | `50` |

### Complex Schema Example

```json
{
  "schema": {
    "type": "object",
    "properties": {
      "className": {
        "type": "string",
        "title": "Class",
        "enum": ["H21", "D21", "H35", "D35"],
        "default": "H21"
      },
      "maxRows": {
        "type": "integer",
        "title": "Max Rows",
        "minimum": 1,
        "maximum": 20,
        "default": 10
      },
      "results": {
        "type": "array",
        "title": "Results",
        "items": {
          "type": "object",
          "properties": {
            "position": { "type": "integer" },
            "name": { "type": "string" },
            "time": { "type": "string" }
          }
        }
      }
    },
    "required": ["className"]
  }
}
```

---

## Datasource Configuration

Datasource configuration allows templates to automatically fetch data from external APIs (like LiveResults) and render dynamic UI controls.

### File Structure

Create a sidecar file: `{template-id}.datasource.json`

```
templates/
  └── individual-results-finish/
      ├── individual-results-finish.ograf.json
      ├── individual-results-finish.datasource.json  ← Datasource config
      └── graphic.js
```

### Configuration Modes

#### 1. Manual Mode

All fields are manually entered by operators.

```json
{
  "version": "1.0",
  "mode": "manual",
  "manual": {
    "fields": ["name", "title"],
    "hiddenFields": []
  }
}
```

#### 2. API Mode

All data is fetched from an external API.

```json
{
  "version": "1.0",
  "mode": "api",
  "api": {
    "provider": "liveresults",
    "fieldMappings": [
      {
        "templateField": "className",
        "apiPath": "className",
        "required": true
      }
    ],
    "uiControls": [
      {
        "type": "class-selector",
        "label": "Class",
        "storeAs": "className",
        "required": true
      }
    ],
    "autoUpdate": {
      "defaultEnabled": true,
      "intervalMs": 5000
    }
  }
}
```

#### 3. Hybrid Mode

Combination of API data and manual input (most common).

```json
{
  "version": "1.0",
  "mode": "hybrid",
  "api": { ... },
  "manual": { ... }
}
```

### UI Control Types

#### Class Selector

Dropdown for selecting orienteering classes.

```json
{
  "type": "class-selector",
  "label": "Class",
  "helpText": "Select the class to display results for",
  "required": true,
  "storeAs": "className",
  "compact": true
}
```

#### Runner Search

Autocomplete search for individual runners.

```json
{
  "type": "runner-search",
  "label": "Runner",
  "helpText": "Search for a runner by name or bib number",
  "required": true,
  "storeAs": "runnerId",
  "searchBy": "both",
  "placeholder": "Search by name or bib number...",
  "populateFields": {
    "runnerName": "name",
    "club": "club",
    "bibNumber": "bib",
    "className": "className"
  }
}
```

#### Control Point Selector

Dropdown for selecting control points/checkpoints.

```json
{
  "type": "control-point-selector",
  "label": "Control Point",
  "helpText": "Select which control point to show results for",
  "required": true,
  "storeAs": "controlCode",
  "multiple": false,
  "includeFinish": false
}
```

#### Leg Selector

Dropdown for selecting relay race legs.

```json
{
  "type": "leg-selector",
  "label": "Leg",
  "helpText": "Select which leg to display",
  "required": true,
  "storeAs": "legNumber",
  "maxLegs": 6
}
```

#### Team Search

Autocomplete search for relay teams.

```json
{
  "type": "team-search",
  "label": "Team",
  "helpText": "Search for a team by name or club",
  "required": true,
  "storeAs": "teamId",
  "searchBy": "both",
  "placeholder": "Search by team name or club...",
  "populateFields": {
    "teamName": "teamName",
    "club": "club",
    "className": "className"
  }
}
```

### Field Mappings

Field mappings connect template fields to API data paths.

```json
{
  "fieldMappings": [
    {
      "templateField": "runnerName",
      "apiPath": "runner.name",
      "required": true
    },
    {
      "templateField": "club",
      "apiPath": "runner.club",
      "required": false
    },
    {
      "templateField": "results",
      "apiPath": "classResults",
      "required": true
    }
  ]
}
```

**API Path Syntax:**
- Dot notation for nested objects: `"runner.name"`
- Array access: `"results[0].time"`
- Root level: `"className"`

### Complete Datasource Example

```json
{
  "version": "1.0",
  "mode": "hybrid",
  "api": {
    "provider": "liveresults",
    "fieldMappings": [
      {
        "templateField": "className",
        "apiPath": "className",
        "required": true
      },
      {
        "templateField": "competitionName",
        "apiPath": "competition.name",
        "required": true
      },
      {
        "templateField": "results",
        "apiPath": "classResults",
        "required": true
      }
    ],
    "uiControls": [
      {
        "type": "class-selector",
        "label": "Class",
        "helpText": "Select the class to display results for",
        "required": true,
        "storeAs": "className",
        "compact": true
      }
    ],
    "autoUpdate": {
      "defaultEnabled": true,
      "intervalMs": 5000
    }
  },
  "manual": {
    "fields": ["maxRows"],
    "hiddenFields": ["results", "competitionName"]
  }
}
```

**Behavior:**
- Shows class selector in Template Settings Panel
- Auto-fetches results from LiveResults API when class is selected
- Allows manual editing of `maxRows` field
- Hides `results` and `competitionName` from manual editing (populated by API)
- Auto-updates every 5 seconds when enabled

---

## HTML/CSS/JavaScript Structure

### Web Component Basics

OGRAF templates are Web Components (Custom Elements).

```javascript
class MyTemplate extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = {};
    this.currentStep = 0;
  }

  connectedCallback() {
    // Called when element is added to DOM
    this.render();
  }

  disconnectedCallback() {
    // Called when element is removed from DOM
    // Clean up timers, event listeners, etc.
  }

  render() {
    // Update shadow DOM
    this.shadowRoot.innerHTML = `
      <style>
        /* Scoped styles */
      </style>
      <div class="container">
        <!-- Template HTML -->
      </div>
    `;
  }

  // OGRAF lifecycle methods
  async playAction(options) { ... }
  async stopAction(options) { ... }
  async updateAction(options) { ... }
  async customAction(options) { ... }
}

// Register custom element
customElements.define('my-template', MyTemplate);
```

### Shadow DOM

Templates use Shadow DOM for style encapsulation.

**Benefits:**
- Styles don't leak out
- External styles don't leak in
- No CSS conflicts between templates

**Example:**
```javascript
this.shadowRoot.innerHTML = `
  <style>
    /* These styles only apply to this template */
    .container {
      background: blue;
    }
  </style>
  <div class="container">
    Content
  </div>
`;
```

### Animation Best Practices

#### CSS Transitions

```css
.container {
  opacity: 0;
  transform: translateY(100%);
  transition: all 0.5s cubic-bezier(0.4, 0.0, 0.2, 1);
}

.container.visible {
  opacity: 1;
  transform: translateY(0);
}
```

#### JavaScript Animations

```javascript
async animateIn() {
  return new Promise(resolve => {
    const container = this.shadowRoot.querySelector('.container');
    container.style.animation = 'slideIn 0.5s ease-out';
    container.addEventListener('animationend', () => resolve(), { once: true });
  });
}
```

#### Respecting skipAnimation

```javascript
async playAction(options = {}) {
  const skipAnimation = options.skipAnimation || false;
  const container = this.shadowRoot.querySelector('.container');

  if (skipAnimation) {
    // Instant display
    container.classList.add('visible');
  } else {
    // Animated display
    await this.animateIn();
    container.classList.add('visible');
  }
}
```

### Data Handling

```javascript
async updateAction(options) {
  this.data = options.data;

  // Update specific elements instead of full re-render
  const nameEl = this.shadowRoot.querySelector('.name');
  const titleEl = this.shadowRoot.querySelector('.title');

  if (nameEl) nameEl.textContent = this.data.name || '';
  if (titleEl) titleEl.textContent = this.data.title || '';

  return { statusCode: 200, message: 'Update action completed' };
}
```

### External Assets

```javascript
render() {
  this.shadowRoot.innerHTML = `
    <style>
      @import url('/templates/my-template/css/styles.css');

      .logo {
        background-image: url('/templates/my-template/images/logo.png');
      }
    </style>
    <div class="container">
      <div class="logo"></div>
    </div>
  `;
}
```

**Asset paths:**
- Templates: `/templates/{template-name}/`
- Global assets: `/assets/`

---

## Testing Templates

### Template Preview Panel

The Template Preview Panel allows you to test templates in isolation.

**Location:** ProjectView > Templates section

**Features:**
- Live preview of template
- Edit data fields in real-time
- Test play/stop/update actions
- Test multi-step transitions
- No need to create a rundown

**How to use:**
1. Open ProjectView
2. Scroll to "Rundown Templates" section
3. Click on a template to preview it
4. Edit fields and click "Play" to test

### Testing in ProductionView

For full integration testing:

1. Create a project and rundown
2. Add template to rundown
3. Configure data in Template Settings Panel
4. Test in Live panel:
   - Click "Play" to show graphic
   - Click "Next Step" for multi-step graphics
   - Click "Stop" to hide graphic
5. Check NDI output (if enabled)
6. Check Web output (if enabled)

### Console Logging

Add console logs for debugging:

```javascript
async playAction(options = {}) {
  console.log('[MyTemplate] Play action called', {
    options,
    currentStep: this.currentStep,
    data: this.data
  });

  // ... implementation ...

  console.log('[MyTemplate] Play action completed', {
    newStep: this.currentStep
  });

  return { statusCode: 200, message: 'Play action completed' };
}
```

**View logs:**
- Main window: View > Toggle Developer Tools
- Graphics window: Right-click > Inspect Element

### Common Issues

#### Template not appearing in list

**Causes:**
- Manifest file name doesn't match `id` field
- Invalid JSON in manifest
- Missing required fields in manifest

**Solution:**
- Check console for errors
- Validate JSON syntax
- Ensure `id` matches filename

#### Animations not working

**Causes:**
- CSS transitions not defined
- Classes not being added/removed
- `skipAnimation` not handled

**Solution:**
- Check CSS transition properties
- Verify class names in JavaScript
- Test with `skipAnimation: false`

#### Data not updating

**Causes:**
- `updateAction` not implemented
- Not calling `render()` after data change
- Shadow DOM not updated

**Solution:**
- Implement `updateAction` method
- Call `this.render()` or update DOM directly
- Check shadow DOM in DevTools

---

## Complete Examples

### Example 1: Simple Lower Third

**Manifest** (`simple-lower-third.ograf.json`):
```json
{
  "$schema": "https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json",
  "id": "simple-lower-third",
  "version": "1.0.0",
  "name": "Simple Lower Third",
  "description": "Basic lower third with name and title",
  "main": "graphic.js",
  "schema": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "title": "Name"
      },
      "title": {
        "type": "string",
        "title": "Title"
      }
    },
    "required": ["name"]
  },
  "supportsRealTime": true,
  "supportsNonRealTime": true,
  "stepCount": 1
}
```

**JavaScript** (`graphic.js`):
```javascript
class SimpleLowerThird extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = {};
    this.currentStep = 0;
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        .container {
          position: absolute;
          bottom: 80px;
          left: 40px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px 30px;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          opacity: 0;
          transform: translateX(-100%);
          transition: all 0.6s cubic-bezier(0.4, 0.0, 0.2, 1);
        }
        .container.visible {
          opacity: 1;
          transform: translateX(0);
        }
        .name {
          font-size: 36px;
          font-weight: bold;
          margin-bottom: 8px;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        }
        .title {
          font-size: 24px;
          opacity: 0.9;
        }
      </style>
      <div class="container">
        <div class="name">${this.data.name || ''}</div>
        <div class="title">${this.data.title || ''}</div>
      </div>
    `;
  }

  async playAction(options = {}) {
    const container = this.shadowRoot.querySelector('.container');
    if (container) {
      container.classList.add('visible');
    }
    this.currentStep = 1;
    return { statusCode: 200, message: 'Play action completed' };
  }

  async stopAction(options = {}) {
    const container = this.shadowRoot.querySelector('.container');
    if (container) {
      container.classList.remove('visible');
    }
    this.currentStep = 0;
    return { statusCode: 200, message: 'Stop action completed' };
  }

  async updateAction(options) {
    this.data = options.data;
    this.render();
    return { statusCode: 200, message: 'Update action completed' };
  }

  async customAction(options) {
    return { statusCode: 404, message: 'Custom action not supported' };
  }
}

customElements.define('simple-lower-third', SimpleLowerThird);
```

### Example 2: Multi-Step Results Table

**Manifest** (`multi-step-results.ograf.json`):
```json
{
  "$schema": "https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json",
  "id": "multi-step-results",
  "version": "1.0.0",
  "name": "Multi-Step Results",
  "description": "Results table with expandable details",
  "main": "graphic.js",
  "schema": {
    "type": "object",
    "properties": {
      "className": {
        "type": "string",
        "title": "Class"
      },
      "results": {
        "type": "array",
        "title": "Results",
        "items": {
          "type": "object",
          "properties": {
            "position": { "type": "integer" },
            "name": { "type": "string" },
            "club": { "type": "string" },
            "time": { "type": "string" }
          }
        }
      }
    },
    "required": ["className", "results"]
  },
  "supportsRealTime": true,
  "supportsNonRealTime": true,
  "stepCount": 3
}
```

**JavaScript** (`graphic.js`):
```javascript
class MultiStepResults extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = { results: [] };
    this.currentStep = 0;
  }

  connectedCallback() {
    this.render();
  }

  render() {
    const results = this.data.results || [];
    const rows = results.slice(0, 10).map((r, i) => `
      <tr>
        <td class="position">${r.position || i + 1}</td>
        <td class="name">${r.name || ''}</td>
        <td class="club step-2-content">${r.club || ''}</td>
        <td class="time step-3-content">${r.time || ''}</td>
      </tr>
    `).join('');

    this.shadowRoot.innerHTML = `
      <style>
        .container {
          position: absolute;
          top: 100px;
          right: 50px;
          background: rgba(0, 0, 0, 0.9);
          color: white;
          padding: 20px;
          border-radius: 8px;
          opacity: 0;
          transform: translateX(100%);
          transition: all 0.5s ease;
          width: 400px;
        }
        .container.visible {
          opacity: 1;
          transform: translateX(0);
        }
        .container.step-2 {
          width: 600px;
        }
        .container.step-3 {
          width: 800px;
        }
        .header {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 15px;
          padding-bottom: 10px;
          border-bottom: 2px solid #667eea;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th, td {
          padding: 8px;
          text-align: left;
        }
        th {
          background: #667eea;
          font-weight: bold;
        }
        tr:nth-child(even) {
          background: rgba(255, 255, 255, 0.05);
        }
        .step-2-content,
        .step-3-content {
          display: none;
        }
        .container.step-2 .step-2-content,
        .container.step-3 .step-2-content,
        .container.step-3 .step-3-content {
          display: table-cell;
        }
      </style>
      <div class="container">
        <div class="header">${this.data.className || 'Results'}</div>
        <table>
          <thead>
            <tr>
              <th>Pos</th>
              <th>Name</th>
              <th class="step-2-content">Club</th>
              <th class="step-3-content">Time</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }

  async playAction(options = {}) {
    const delta = options.delta || 0;
    const goto = options.goto;

    let targetStep;
    if (goto !== undefined) {
      targetStep = goto;
    } else if (delta !== 0) {
      targetStep = this.currentStep + delta;
    } else {
      targetStep = this.currentStep === 0 ? 1 : this.currentStep;
    }

    targetStep = Math.max(1, Math.min(targetStep, 3));

    const container = this.shadowRoot.querySelector('.container');
    if (container) {
      container.classList.remove('step-1', 'step-2', 'step-3');
      container.classList.add(`step-${targetStep}`);
      container.classList.add('visible');
    }

    this.currentStep = targetStep;
    return { statusCode: 200, message: 'Play action completed', currentStep: this.currentStep };
  }

  async stopAction(options = {}) {
    const container = this.shadowRoot.querySelector('.container');
    if (container) {
      container.classList.remove('visible');
      container.classList.remove('step-1', 'step-2', 'step-3');
    }
    this.currentStep = 0;
    return { statusCode: 200, message: 'Stop action completed' };
  }

  async updateAction(options) {
    this.data = options.data;
    this.render();
    return { statusCode: 200, message: 'Update action completed' };
  }

  async customAction(options) {
    return { statusCode: 404, message: 'Custom action not supported' };
  }
}

customElements.define('multi-step-results', MultiStepResults);
```

---

## Best Practices

### 1. Use Semantic Versioning

Update `version` in manifest when making changes:
- **Patch** (1.0.0 → 1.0.1): Bug fixes
- **Minor** (1.0.0 → 1.1.0): New features, backward compatible
- **Major** (1.0.0 → 2.0.0): Breaking changes

### 2. Handle Missing Data Gracefully

```javascript
render() {
  const name = this.data.name || 'Unknown';
  const title = this.data.title || '';
  // ...
}
```

### 3. Clean Up Resources

```javascript
disconnectedCallback() {
  // Clear timers
  if (this.updateTimer) {
    clearInterval(this.updateTimer);
  }

  // Remove event listeners
  if (this.resizeHandler) {
    window.removeEventListener('resize', this.resizeHandler);
  }
}
```

### 4. Use CSS Variables for Theming

```css
:host {
  --primary-color: #667eea;
  --secondary-color: #764ba2;
  --text-color: white;
}

.container {
  background: var(--primary-color);
  color: var(--text-color);
}
```

### 5. Optimize Rendering

```javascript
// Bad: Full re-render on every update
async updateAction(options) {
  this.data = options.data;
  this.render(); // Rebuilds entire shadow DOM
}

// Good: Update only changed elements
async updateAction(options) {
  this.data = options.data;
  const nameEl = this.shadowRoot.querySelector('.name');
  if (nameEl) nameEl.textContent = this.data.name || '';
}
```

### 6. Test on Different Resolutions

Templates should work on:
- 1920x1080 (Full HD)
- 1280x720 (HD)
- 3840x2160 (4K)

Use relative positioning and responsive units:
```css
.container {
  font-size: 2vw; /* Scales with viewport width */
  bottom: 5vh;    /* 5% of viewport height */
}
```

### 7. Document Your Template

Add comments in your code:
```javascript
/**
 * Multi-Step Lower Third
 *
 * Step 1: Name only
 * Step 2: Name + Title
 * Step 3: Name + Title + Club
 */
class MyTemplate extends HTMLElement {
  // ...
}
```

### 8. Follow Naming Conventions

- Template ID: `kebab-case` (e.g., `runner-spotlight`)
- CSS classes: `kebab-case` (e.g., `.lower-third`)
- JavaScript variables: `camelCase` (e.g., `currentStep`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_ROWS`)

### 9. Use Datasource Configuration

Instead of hardcoding API logic in templates, use datasource configuration:
- Separates data fetching from presentation
- Makes templates more reusable
- Easier to maintain

### 10. Test with Real Data

Always test templates with:
- Real competition data
- Edge cases (long names, missing data)
- Different data sizes (1 row vs 100 rows)
- Special characters (åäö, etc.)

---

## Additional Resources

- **OGRAF Specification:** https://ograf.ebu.io/v1/specification/
- **JSON Schema:** https://json-schema.org/
- **Web Components:** https://developer.mozilla.org/en-US/docs/Web/Web_Components
- **Shadow DOM:** https://developer.mozilla.org/en-US/docs/Web/Web_Components/Using_shadow_DOM
- **CSS Animations:** https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Animations

---

**Need help?** Check the existing templates in the `templates/` directory for more examples!


