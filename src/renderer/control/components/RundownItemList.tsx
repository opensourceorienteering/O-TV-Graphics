/**
 * Rundown Item List Component
 * Displays rundown items with selection, status indicators, and playback controls
 */

import { useState } from 'react';
import { Play, Square, GripVertical, Trash2, Layers, Maximize2, ChevronRight } from 'lucide-react';
import { SPXRundownItem } from '../../../shared/types/spx';
import { OGrafTemplateInfo } from '../../../shared/types/ograf';

interface RundownItemListProps {
  items: SPXRundownItem[];
  templates: OGrafTemplateInfo[];
  selectedItemId: string | null;
  onSelectItem: (itemId: string) => void;
  onPlayItem: (itemId: string) => void;
  onStopItem: (itemId: string) => void;
  onNextStep: (itemId: string) => void;
  onDeleteItem: (itemId: string) => void;
  onReorderItems?: (itemIds: string[]) => void;
}

export function RundownItemList({
  items,
  templates,
  selectedItemId,
  onSelectItem,
  onPlayItem,
  onStopItem,
  onNextStep,
  onDeleteItem,
  onReorderItems
}: RundownItemListProps) {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  // Helper function to get template color based on template ID
  const getTemplateColor = (templateId: string): string => {
    const colors: Record<string, string> = {
      'competition-info': '#4a7c9e',
      'runner-spotlight': '#9e7c4a',
      'results': '#7c4a9e',
      'lower-third': '#4a9e7c',
      'split-times': '#9e4a7c',
      'start-list': '#7c9e4a',
      'relay': '#9e7c7c',
      'default': '#666'
    };

    // Try to match template ID
    for (const [key, color] of Object.entries(colors)) {
      if (templateId.toLowerCase().includes(key)) {
        return color;
      }
    }

    return colors.default;
  };

  // Drag-and-drop handlers
  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedItemId(itemId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemId);
  };

  const handleDragOver = (e: React.DragEvent, itemId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (draggedItemId && draggedItemId !== itemId) {
      setDragOverItemId(itemId);
    }
  };

  const handleDragLeave = () => {
    setDragOverItemId(null);
  };

  const handleDrop = (e: React.DragEvent, dropTargetId: string) => {
    e.preventDefault();

    if (!draggedItemId || draggedItemId === dropTargetId || !onReorderItems) {
      setDraggedItemId(null);
      setDragOverItemId(null);
      return;
    }

    // Find indices
    const draggedIndex = items.findIndex(item => item.id === draggedItemId);
    const dropIndex = items.findIndex(item => item.id === dropTargetId);

    if (draggedIndex === -1 || dropIndex === -1) {
      setDraggedItemId(null);
      setDragOverItemId(null);
      return;
    }

    // Create new order
    const newItems = [...items];
    const [draggedItem] = newItems.splice(draggedIndex, 1);
    newItems.splice(dropIndex, 0, draggedItem);

    // Call reorder callback with new item IDs order
    onReorderItems(newItems.map(item => item.id));

    setDraggedItemId(null);
    setDragOverItemId(null);
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
    setDragOverItemId(null);
  };

  if (items.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#888',
        fontSize: '0.9rem'
      }}>
        <p>No items in rundown</p>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      paddingRight: '0.5rem'
    }}>
      {items.map((item, index) => {
        const template = templates.find(t => t.manifest.id === item.templateId);
        const templateColor = getTemplateColor(item.templateId);
        const isSelected = selectedItemId === item.id;
        const isOnAir = item.onair;
        // Priority: rundown item > template manifest > default to stackable
        const playbackMode = item.playbackMode || template?.manifest.playbackMode || 'stackable';
        const isSolo = playbackMode === 'solo';
        const isDragging = draggedItemId === item.id;
        const isDragOver = dragOverItemId === item.id;

        return (
          <div
            key={item.id}
            data-item-id={item.id}
            draggable={true}
            onDragStart={(e) => handleDragStart(e, item.id)}
            onDragOver={(e) => handleDragOver(e, item.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, item.id)}
            onDragEnd={handleDragEnd}
            onClick={() => onSelectItem(item.id)}
            style={{
              padding: '0.75rem',
              background: isOnAir ? '#1a3a1a' : isSelected ? '#2a2a2a' : '#1a1a1a',
              borderRadius: '4px',
              marginBottom: '0.5rem',
              borderTop: isDragOver ? '3px solid #4a7c9e' : isOnAir ? '2px solid #4a9e4a' : isSelected ? '2px solid #4a7c9e' : '1px solid #333',
              borderRight: isOnAir ? '2px solid #4a9e4a' : isSelected ? '2px solid #4a7c9e' : '1px solid #333',
              borderBottom: isOnAir ? '2px solid #4a9e4a' : isSelected ? '2px solid #4a7c9e' : '1px solid #333',
              borderLeft: `4px solid ${isOnAir ? '#4a9e4a' : templateColor}`,
              position: 'relative',
              boxShadow: isOnAir ? '0 0 10px rgba(74, 158, 74, 0.3)' : isSelected ? '0 0 10px rgba(74, 124, 158, 0.3)' : 'none',
              cursor: isDragging ? 'grabbing' : 'pointer',
              opacity: isDragging ? 0.5 : 1,
              transition: 'all 0.2s ease'
            }}
          >
            {/* ON AIR Badge - Moved to left side to avoid overlapping controls */}
            {isOnAir && (
              <div style={{
                position: 'absolute',
                top: '0.5rem',
                left: '3rem',
                padding: '0.25rem 0.5rem',
                background: '#4a9e4a',
                color: 'white',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                borderRadius: '3px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                zIndex: 1
              }}>
                <div style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'white',
                  animation: 'pulse 2s infinite'
                }} />
                ON AIR
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'start' }}>
              {/* Drag Handle */}
              <div
                style={{
                  color: isDragging ? '#4a7c9e' : '#666',
                  cursor: isDragging ? 'grabbing' : 'grab',
                  paddingTop: '0.25rem',
                  transition: 'color 0.2s ease'
                }}
                title="Drag to reorder"
              >
                <GripVertical size={18} />
              </div>

              {/* Item Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Header Row */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '0.5rem'
                }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{
                      fontWeight: 'bold',
                      fontSize: '0.875rem',
                      color: '#888',
                      minWidth: '2rem'
                    }}>
                      #{index + 1}
                    </span>

                    {/* Playback Mode Indicator */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '20px',
                        height: '20px',
                        borderRadius: '3px',
                        background: isSolo ? '#9e4a4a' : '#4a7c9e',
                        color: 'white',
                        flexShrink: 0
                      }}
                      title={isSolo ? 'Solo mode - stops other graphics' : 'Stackable - can play with others'}
                    >
                      {isSolo ? <Maximize2 size={12} /> : <Layers size={12} />}
                    </div>

                    <span style={{
                      fontSize: '0.875rem',
                      fontWeight: '500',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {item.instanceName || template?.manifest.name || item.templateId}
                    </span>
                    {item.instanceName && (
                      <span style={{
                        fontSize: '0.7rem',
                        color: '#666',
                        marginLeft: '0.5rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        ({template?.manifest.name || item.templateId})
                      </span>
                    )}
                  </div>

                  {/* Playback Controls */}
                  <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                    {isOnAir ? (
                      <button
                        className="btn btn-sm btn-warning"
                        onClick={(e) => {
                          e.stopPropagation();
                          onStopItem(item.id);
                        }}
                        title="Stop (Space)"
                        style={{ padding: '0.25rem 0.5rem' }}
                      >
                        <Square size={14} />
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm btn-success"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPlayItem(item.id);
                        }}
                        title="Play (Space)"
                        style={{ padding: '0.25rem 0.5rem' }}
                      >
                        <Play size={14} />
                      </button>
                    )}

                    {/* Next Step Button - Only show for multi-step graphics that are onair */}
                    {(() => {
                      const template = templates.find(t => t.directoryName === item.templateId);
                      // Show if stepCount is 0 (auto) or > 1 (explicit multi-step)
                      const isMultiStep = template && (template.manifest.stepCount === 0 || (template.manifest.stepCount && template.manifest.stepCount > 1));
                      return isOnAir && isMultiStep ? (
                        <button
                          className="btn btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNextStep(item.id);
                          }}
                          title="Next Step (→)"
                          style={{
                            padding: '0.25rem 0.5rem',
                            background: '#9e7c4a',
                            border: '1px solid #ae8c5a',
                            color: '#fff'
                          }}
                        >
                          <ChevronRight size={14} />
                        </button>
                      ) : null;
                    })()}

                    {/* Delete Button */}
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('Delete this item from the rundown?')) {
                          onDeleteItem(item.id);
                        }
                      }}
                      title="Delete item"
                      style={{ padding: '0.25rem 0.5rem' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Status Indicator */}
                <div style={{
                  fontSize: '0.75rem',
                  color: isOnAir ? '#4a9e4a' : '#666',
                  fontWeight: isOnAir ? 'bold' : 'normal'
                }}>
                  {isOnAir ? 'ON AIR' : 'Ready'}
                </div>

                {/* Field Preview - Show first 2 fields */}
                {Object.keys(item.fields || {}).length > 0 && (
                  <div style={{
                    marginTop: '0.5rem',
                    padding: '0.5rem',
                    background: '#0a0a0a',
                    borderRadius: '3px',
                    fontSize: '0.75rem',
                    color: '#888'
                  }}>
                    {Object.entries(item.fields || {}).slice(0, 2).map(([key, value]) => (
                      <div key={key} style={{ marginBottom: '0.25rem' }}>
                        <strong>{key}:</strong> {String(value).substring(0, 30)}{String(value).length > 30 ? '...' : ''}
                      </div>
                    ))}
                    {Object.keys(item.fields || {}).length > 2 && (
                      <div style={{ color: '#666', fontStyle: 'italic' }}>
                        +{Object.keys(item.fields || {}).length - 2} more fields
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

