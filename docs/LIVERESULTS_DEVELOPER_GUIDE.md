# 🔧 LiveResults Integration - Developer Guide

**TV-Grafik LiveResults Integration**  
**Version**: 1.0.0  
**Last Updated**: 2025-10-17

---

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Data Flow](#data-flow)
3. [Component Reference](#component-reference)
4. [IPC Handlers](#ipc-handlers)
5. [Data Mapping](#data-mapping)
6. [Extending the System](#extending-the-system)
7. [Best Practices](#best-practices)

---

## 🏗️ Architecture Overview

### **System Components**

```
┌─────────────────────────────────────────────────────────────┐
│                     Renderer Process                         │
├─────────────────────────────────────────────────────────────┤
│  ProjectView                                                 │
│  ├── Project Settings Modal                                  │
│  │   └── CompetitionSelector                                │
│  └── Item Editor                                             │
│      ├── LiveResults Integration Section                    │
│      │   ├── Competition Selector (dropdown)                │
│      │   └── ClassSelector (compact)                        │
│      └── TemplateFieldEditor                                │
│          └── Auto-Fill Button                               │
└─────────────────────────────────────────────────────────────┘
                            ↕ IPC
┌─────────────────────────────────────────────────────────────┐
│                      Main Process                            │
├─────────────────────────────────────────────────────────────┤
│  IPC Handlers (dataHandlers.ts)                             │
│  ├── data:getCompetitions                                   │
│  ├── data:getClasses                                        │
│  ├── data:getResults                                        │
│  └── data:autoMapTemplate                                   │
│                                                              │
│  DataStore                                                   │
│  ├── Competition Cache                                      │
│  ├── Class Cache                                            │
│  └── Results Cache                                          │
│                                                              │
│  LiveResultsClient                                          │
│  └── API Communication                                      │
│                                                              │
│  LiveResultsMapper                                          │
│  └── Data Transformation                                    │
└─────────────────────────────────────────────────────────────┘
                            ↕ HTTP
┌─────────────────────────────────────────────────────────────┐
│              LiveResults API                                 │
│         https://liveresultat.orientering.se                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow

### **Competition Selection Flow**

```typescript
// 1. User opens project settings
setShowProjectSettings(true)

// 2. CompetitionSelector loads competitions
const result = await window.electronAPI.invoke('data:getCompetitions')
// → IPC → DataStore.getCompetitions()
// → LiveResultsClient.fetchCompetitions()
// → API: GET /api.php?method=getcompetitions

// 3. User selects competition
handleUpdateProjectCompetition(competition)
// → Updates project.liveResults.competitionId
// → Saves to project.json

// 4. Competition is now available for all items
```

### **Auto-Fill Flow**

```typescript
// 1. User selects class
setItemClassName('M21')

// 2. User clicks auto-fill
handleAutoFill()

// 3. Fetch competition data
const compResult = await window.electronAPI.invoke('data:getCachedCompetitions')
const competition = compResult.data?.find(c => c.id === competitionId)

// 4. Fetch class results
const resultsResult = await window.electronAPI.invoke('data:getResults', competitionId, className)
// → IPC → DataStore.getResults()
// → LiveResultsClient.fetchResults()
// → API: GET /api.php?method=getclassresults&comp={id}&class={name}

// 5. Map data to template format
const mapResult = await window.electronAPI.invoke('data:autoMapTemplate', {
  competition,
  className,
  classResult: resultsResult.data,
  templateId: manifest.id
})
// → IPC → LiveResultsMapper.autoMap()
// → Returns mapped template data

// 6. Update form fields
setFormData(mapResult.data)
```

---

## 🧩 Component Reference

### **CompetitionSelector**

**File**: `src/renderer/control/components/CompetitionSelector.tsx`

**Props**:
```typescript
interface CompetitionSelectorProps {
  selectedCompetitionId?: number;
  onSelect: (competition: LiveResultsCompetition | null) => void;
  onClose?: () => void;
  showCloseButton?: boolean;
}
```

**Usage**:
```tsx
<CompetitionSelector
  selectedCompetitionId={project.liveResults?.competitionId}
  onSelect={handleUpdateProjectCompetition}
/>
```

**Features**:
- Fetches competitions via `data:getCompetitions` IPC
- Displays list with name, date, organizer
- Refresh button to reload
- Clear selection option
- Visual selection indicators

---

### **ClassSelector**

**File**: `src/renderer/control/components/ClassSelector.tsx`

**Props**:
```typescript
interface ClassSelectorProps {
  competitionId: number;
  selectedClassName?: string;
  onSelect: (className: string | null) => void;
  onClose?: () => void;
  showCloseButton?: boolean;
  compact?: boolean; // Dropdown vs. full panel
}
```

**Usage**:
```tsx
// Compact mode (dropdown)
<ClassSelector
  competitionId={competitionId}
  selectedClassName={className}
  onSelect={setClassName}
  compact={true}
/>

// Full panel mode
<ClassSelector
  competitionId={competitionId}
  selectedClassName={className}
  onSelect={setClassName}
  onClose={() => setShowClassSelector(false)}
  showCloseButton={true}
/>
```

**Features**:
- Auto-loads classes when competitionId changes
- Two display modes: compact dropdown and full panel
- Fetches classes via `data:getClasses` IPC
- Refresh button to reload
- Clear selection option

---

### **TemplateFieldEditor (Enhanced)**

**File**: `src/renderer/control/components/TemplateFieldEditor.tsx`

**New Props**:
```typescript
interface TemplateFieldEditorProps {
  // ... existing props
  competitionId?: number;
  className?: string;
  enableAutoFill?: boolean;
}
```

**Usage**:
```tsx
<TemplateFieldEditor
  manifest={template.manifest}
  initialData={fields}
  onChange={setFields}
  showActions={false}
  competitionId={itemCompetitionId || project?.liveResults?.competitionId}
  className={itemClassName}
  enableAutoFill={!!(competitionId && className)}
/>
```

**Auto-Fill Implementation**:
```typescript
const handleAutoFill = async () => {
  if (!competitionId || !className) {
    setAutoFillError('Competition and class must be selected');
    return;
  }

  setAutoFilling(true);
  setAutoFillError(null);

  try {
    // Get competition data
    const compResult = await window.electronAPI.invoke('data:getCachedCompetitions');
    const competition = compResult.data?.find((c: any) => c.id === competitionId);
    
    // Get class results
    const resultsResult = await window.electronAPI.invoke('data:getResults', competitionId, className);
    
    // Auto-map data
    const mapResult = await window.electronAPI.invoke('data:autoMapTemplate', {
      competition,
      className,
      classResult: resultsResult.data,
      templateId: manifest.id
    });

    if (mapResult.success && mapResult.data) {
      setFormData(mapResult.data);
    }
  } catch (err) {
    setAutoFillError(err instanceof Error ? err.message : 'Auto-fill failed');
  } finally {
    setAutoFilling(false);
  }
};
```

---

## 📡 IPC Handlers

### **data:getCompetitions**

**Purpose**: Fetch all available competitions from LiveResults API

**Parameters**: None

**Returns**:
```typescript
{
  success: boolean;
  data?: LiveResultsCompetition[];
  error?: string;
}
```

**Example**:
```typescript
const result = await window.electronAPI.invoke('data:getCompetitions');
if (result.success) {
  setCompetitions(result.data);
}
```

---

### **data:getClasses**

**Purpose**: Fetch all classes for a specific competition

**Parameters**:
```typescript
competitionId: number
```

**Returns**:
```typescript
{
  success: boolean;
  data?: string[];
  error?: string;
}
```

**Example**:
```typescript
const result = await window.electronAPI.invoke('data:getClasses', competitionId);
if (result.success) {
  setClasses(result.data);
}
```

---

### **data:getResults**

**Purpose**: Fetch results for a specific class in a competition

**Parameters**:
```typescript
competitionId: number
className: string
```

**Returns**:
```typescript
{
  success: boolean;
  data?: LiveResultsClassResult;
  error?: string;
}
```

**Example**:
```typescript
const result = await window.electronAPI.invoke('data:getResults', competitionId, 'M21');
if (result.success) {
  setResults(result.data);
}
```

---

### **data:autoMapTemplate**

**Purpose**: Automatically map LiveResults data to template-specific format

**Parameters**:
```typescript
{
  competition: LiveResultsCompetition;
  className: string;
  classResult: LiveResultsClassResult;
  templateId?: string;
  options?: {
    templateType?: 'start-list' | 'results-finish' | 'results-control' | 'lower-third' | 'split-times';
    runnerName?: string;
    bibNumber?: string;
    controlCode?: string;
    maxRows?: number;
  };
}
```

**Returns**:
```typescript
{
  success: boolean;
  data?: Record<string, any>; // Template-specific data
  error?: string;
}
```

**Example**:
```typescript
const result = await window.electronAPI.invoke('data:autoMapTemplate', {
  competition: selectedCompetition,
  className: 'M21',
  classResult: classResults,
  templateId: 'orienteering-individual-start-list'
});

if (result.success) {
  setFormData(result.data);
}
```

---

## 🗺️ Data Mapping

### **LiveResultsMapper**

**File**: `src/main/data/LiveResultsMapper.ts`

**Purpose**: Transform LiveResults API data into template-specific formats

**Key Methods**:

```typescript
class LiveResultsMapper {
  // Auto-detect template type and map accordingly
  static autoMap(
    competition: LiveResultsCompetition,
    className: string,
    classResult: LiveResultsClassResult,
    options?: AutoMapOptions
  ): { templateType: string; data: Record<string, any> }

  // Individual competition mappers
  static mapIndividualStartList(...)
  static mapIndividualLowerThirdRunner(...)
  static mapIndividualResultsFinish(...)
  static mapIndividualResultsControl(...)
  static mapIndividualSplitTimesLeader(...)
  static mapIndividualSplitTimesFocus(...)

  // Relay competition mappers
  static mapRelayStartList(...)
  static mapRelayLowerThirdTeam(...)
  static mapRelayLowerThirdRunner(...)
  static mapRelayResultsTeamFinish(...)
  static mapRelayResultsLeg(...)
  static mapRelayResultsLegControl(...)
  static mapRelaySplitTimesLeader(...)
  static mapRelaySplitTimesFocus(...)
}
```

**Adding a New Mapper**:

```typescript
// 1. Define the mapping function
static mapMyNewTemplate(
  competition: LiveResultsCompetition,
  className: string,
  classResult: LiveResultsClassResult,
  options?: { maxRows?: number }
): Record<string, any> {
  return {
    competitionName: competition.name,
    className: className,
    myCustomField: classResult.results[0]?.name || '',
    // ... more fields
  };
}

// 2. Add to autoMap() switch statement
case 'my-new-template':
  return {
    templateType: 'my-new-template',
    data: this.mapMyNewTemplate(competition, className, classResult, options)
  };
```

---

## 🔧 Extending the System

### **Adding a New Template with LiveResults Support**

**Step 1: Create Template Files**
```bash
templates/my-new-template/
├── manifest.json
├── graphic.html
├── graphic.css
└── graphic.js
```

**Step 2: Define Schema in manifest.json**
```json
{
  "id": "my-new-template",
  "name": "My New Template",
  "schema": {
    "type": "object",
    "properties": {
      "competitionName": { "type": "string" },
      "className": { "type": "string" },
      "myCustomField": { "type": "string" }
    }
  }
}
```

**Step 3: Add Mapper Function**
```typescript
// In LiveResultsMapper.ts
static mapMyNewTemplate(
  competition: LiveResultsCompetition,
  className: string,
  classResult: LiveResultsClassResult
): Record<string, any> {
  return {
    competitionName: competition.name,
    className: className,
    myCustomField: classResult.results[0]?.name || ''
  };
}
```

**Step 4: Register in autoMap()**
```typescript
// In LiveResultsMapper.autoMap()
if (options?.templateId === 'my-new-template') {
  return {
    templateType: 'my-new-template',
    data: this.mapMyNewTemplate(competition, className, classResult)
  };
}
```

**Step 5: Test**
```typescript
// Create item with template
// Select competition and class
// Click auto-fill
// Verify fields are populated correctly
```

---

## ✅ Best Practices

### **1. Error Handling**
```typescript
// Always wrap IPC calls in try-catch
try {
  const result = await window.electronAPI.invoke('data:getResults', id, className);
  if (result.success) {
    // Handle success
  } else {
    setError(result.error || 'Unknown error');
  }
} catch (err) {
  setError(err instanceof Error ? err.message : 'Request failed');
}
```

### **2. Loading States**
```typescript
// Always show loading indicators
const [loading, setLoading] = useState(false);

const fetchData = async () => {
  setLoading(true);
  try {
    const result = await window.electronAPI.invoke('data:getResults', id, className);
    // ... handle result
  } finally {
    setLoading(false);
  }
};
```

### **3. Caching**
```typescript
// Use cached data when possible
const compResult = await window.electronAPI.invoke('data:getCachedCompetitions');
// vs.
const compResult = await window.electronAPI.invoke('data:getCompetitions'); // API call
```

### **4. Type Safety**
```typescript
// Always use TypeScript types
import { LiveResultsCompetition, LiveResultsClassResult } from '../../../shared/types/liveresults';

const handleSelect = (competition: LiveResultsCompetition | null) => {
  // TypeScript ensures type safety
};
```

### **5. User Feedback**
```typescript
// Provide clear feedback for all states
{loading && <div>Loading...</div>}
{error && <div className="error">{error}</div>}
{success && <div className="success">Data loaded!</div>}
```

---

## 📚 Additional Resources

- **LiveResults API Documentation**: https://liveresultat.orientering.se
- **OGRAF v1 Specification**: EBU OGRAF v1 standard
- **TypeScript Documentation**: https://www.typescriptlang.org/docs/
- **React Documentation**: https://react.dev/

---

**Happy Coding!** 🚀

