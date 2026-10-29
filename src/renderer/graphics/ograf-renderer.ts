/**
 * OGRAF Renderer
 * Manages OGRAF graphics lifecycle in the graphics output window
 */

import {
  OGrafManifest,
  OGrafGraphic,
  GraphicState,
  LoadOptions,
  PlayActionOptions,
  StopActionOptions,
  UpdateActionOptions,
  CustomActionOptions,
  ReturnPayload,
  PlayActionReturnPayload,
} from "../../shared/types/ograf";
import { defineOGrafGraphic } from "./ograf-loader";

/**
 * Renderer error
 */
export class RendererError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any,
  ) {
    super(message);
    this.name = "RendererError";
  }
}

function checkResult(result: ReturnPayload | undefined, action: string): void {
  if (result && result.statusCode >= 400)
    throw new RendererError(
      result.message || `${action} returned status ${result.statusCode}`,
      "GRAPHIC_ACTION_FAILED",
    );
}

/**
 * OGRAF Renderer class
 */
export class OGrafRenderer {
  private graphics: Map<string, GraphicState>;
  private container: HTMLElement;
  private baseUrl: string;

  constructor(container: HTMLElement, baseUrl = "http://localhost:5657") {
    this.graphics = new Map();
    this.container = container;
    this.baseUrl = baseUrl;

    console.log("[OGrafRenderer] Initialized", { baseUrl });
  }

  /**
   * Load a graphic from manifest
   */
  async loadGraphic(
    id: string,
    manifest: OGrafManifest,
    templateId: string,
    data: any,
  ): Promise<ReturnPayload> {
    console.log("[OGrafRenderer] Loading graphic", {
      id,
      name: manifest.name,
      templateId,
    });

    let created = false;
    try {
      // Check if already loaded
      if (this.graphics.has(id)) {
        throw new RendererError(
          `Graphic already loaded: ${id}`,
          "ALREADY_LOADED",
        );
      }

      // Construct the module URL using templateId
      // The web server serves templates at: /templates/{templateId}/{file}
      // Add cache-busting timestamp to force fresh loads when templates are updated
      const cacheBuster = Date.now();
      const moduleUrl = `${this.baseUrl}/templates/${templateId}/${manifest.main}?v=${cacheBuster}`;

      console.log("[OGrafRenderer] Loading module", {
        moduleUrl,
        templateId,
        mainFile: manifest.main,
        cacheBuster,
      });

      // Import the module and register its default export (OGraf v1) under a unique tag
      const tagName = await defineOGrafGraphic(moduleUrl, templateId);
      const element = document.createElement(tagName) as OGrafGraphic;

      if (!element) {
        throw new RendererError(
          `Failed to create element: ${tagName}`,
          "ELEMENT_CREATION_FAILED",
        );
      }

      // Verify the element implements the OGRAF interface
      if (typeof element.load !== "function") {
        throw new RendererError(
          `Element does not implement OGRAF interface: ${tagName}`,
          "INVALID_INTERFACE",
        );
      }

      // Add to container (hidden initially)
      element.style.display = "none";
      this.container.appendChild(element);

      // Initialize graphic state
      const state: GraphicState = {
        id,
        manifestPath: templateId, // Store templateId (directory name) for reference
        manifest,
        currentStep: 0,
        isPlaying: false,
        data,
        element,
      };

      this.graphics.set(id, state);
      created = true;

      // Call load method
      const loadOptions: LoadOptions = { data };
      const result = await element.load(loadOptions);
      checkResult(result, "Load");

      console.log("[OGrafRenderer] Graphic loaded", { id, result });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[OGrafRenderer] Load failed", { id, error: message });
      if (created) {
        const element = this.graphics.get(id)?.element;
        try {
          await element?.dispose();
        } catch {
          /* Preserve the load error; still detach the failed graphic. */
        } finally {
          if (element?.parentNode) element.parentNode.removeChild(element);
          this.graphics.delete(id);
        }
      }

      throw new RendererError(
        `Failed to load graphic: ${message}`,
        "LOAD_FAILED",
        error,
      );
    }
  }

  /**
   * Play action
   */
  async playGraphic(
    id: string,
    options: PlayActionOptions = {},
  ): Promise<PlayActionReturnPayload> {
    console.log("[OGrafRenderer] Play action", { id, options });

    const state = this.getGraphicState(id);

    try {
      // Show the element
      if (state.element) {
        state.element.style.display = "block";
      }

      // Call play action
      const result = await state.element!.playAction(options);
      checkResult(result, "Play");

      // Update state
      state.isPlaying = true;
      state.currentStep = result.currentStep;

      console.log("[OGrafRenderer] Play complete", {
        id,
        currentStep: result.currentStep,
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[OGrafRenderer] Play failed", { id, error: message });

      throw new RendererError(
        `Failed to play graphic: ${message}`,
        "PLAY_FAILED",
        error,
      );
    }
  }

  /**
   * Stop action
   */
  async stopGraphic(
    id: string,
    options: StopActionOptions = {},
  ): Promise<ReturnPayload> {
    console.log("[OGrafRenderer] Stop action", { id, options });

    const state = this.getGraphicState(id);

    try {
      // Call stop action
      const result = await state.element!.stopAction(options);
      checkResult(result, "Stop");

      // Update state
      state.isPlaying = false;

      // Hide the element if skipAnimation is true
      if (options.skipAnimation && state.element) {
        state.element.style.display = "none";
      }

      console.log("[OGrafRenderer] Stop complete", { id });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[OGrafRenderer] Stop failed", { id, error: message });

      throw new RendererError(
        `Failed to stop graphic: ${message}`,
        "STOP_FAILED",
        error,
      );
    }
  }

  /**
   * Update action
   */
  async updateGraphic(
    id: string,
    data: any,
    skipAnimation?: boolean,
  ): Promise<ReturnPayload> {
    console.log("[OGrafRenderer] Update action", { id });

    const state = this.getGraphicState(id);

    try {
      // Call update action
      const options: UpdateActionOptions = skipAnimation
        ? { data, skipAnimation }
        : { data };
      const result = await state.element!.updateAction(options);
      checkResult(result, "Update");

      // Update cached data
      state.data = data;

      console.log("[OGrafRenderer] Update complete", { id });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[OGrafRenderer] Update failed", { id, error: message });

      throw new RendererError(
        `Failed to update graphic: ${message}`,
        "UPDATE_FAILED",
        error,
      );
    }
  }

  /**
   * Custom action
   */
  async customAction(
    id: string,
    actionId: string,
    payload?: any,
    skipAnimation?: boolean,
  ): Promise<ReturnPayload> {
    console.log("[OGrafRenderer] Custom action", { id, actionId });

    const state = this.getGraphicState(id);

    try {
      const options: CustomActionOptions = skipAnimation
        ? { id: actionId, payload, skipAnimation }
        : { id: actionId, payload };
      const result = await state.element!.customAction(options);
      checkResult(result, "Custom action");

      console.log("[OGrafRenderer] Custom action complete", { id, actionId });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[OGrafRenderer] Custom action failed", {
        id,
        actionId,
        error: message,
      });

      throw new RendererError(
        `Failed to execute custom action: ${message}`,
        "CUSTOM_ACTION_FAILED",
        error,
      );
    }
  }

  /**
   * Dispose graphic
   */
  async disposeGraphic(id: string): Promise<ReturnPayload> {
    console.log("[OGrafRenderer] Disposing graphic", { id });

    const state = this.getGraphicState(id);

    try {
      // Call dispose method
      const result = await state.element!.dispose();
      checkResult(result, "Dispose");

      console.log("[OGrafRenderer] Graphic disposed", { id });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[OGrafRenderer] Dispose failed", { id, error: message });

      throw new RendererError(
        `Failed to dispose graphic: ${message}`,
        "DISPOSE_FAILED",
        error,
      );
    } finally {
      if (state.element?.parentNode)
        state.element.parentNode.removeChild(state.element);
      this.graphics.delete(id);
    }
  }

  /**
   * Get graphic state (throws if not found)
   */
  private getGraphicState(id: string): GraphicState {
    const state = this.graphics.get(id);
    if (!state) {
      throw new RendererError(`Graphic not found: ${id}`, "NOT_FOUND");
    }
    return state;
  }

  /**
   * Get all loaded graphics
   */
  getLoadedGraphics(): GraphicState[] {
    return Array.from(this.graphics.values());
  }

  /**
   * Check if graphic is loaded
   */
  isLoaded(id: string): boolean {
    return this.graphics.has(id);
  }

  /**
   * Get graphic state (returns null if not found)
   */
  getGraphic(id: string): GraphicState | null {
    return this.graphics.get(id) || null;
  }

  /**
   * Clear all graphics
   */
  async clearAll(): Promise<void> {
    console.log("[OGrafRenderer] Clearing all graphics");

    const ids = Array.from(this.graphics.keys());

    for (const id of ids) {
      try {
        await this.disposeGraphic(id);
      } catch (error) {
        console.error(
          "[OGrafRenderer] Failed to dispose graphic during clear",
          { id, error },
        );
      }
    }
  }

  /**
   * Get count of loaded graphics
   */
  getLoadedCount(): number {
    return this.graphics.size;
  }

  /**
   * Get count of playing graphics
   */
  getPlayingCount(): number {
    let count = 0;
    this.graphics.forEach((state) => {
      if (state.isPlaying) {
        count++;
      }
    });
    return count;
  }
}
