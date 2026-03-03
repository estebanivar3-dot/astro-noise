/**
 * Tool router — manages tool registration, activation, and DOM lifecycle.
 *
 * Each tool provides createLeftPanel / createRightPanel methods that build
 * their UI into the shared panel containers. The router handles switching
 * between tools: tearing down the old UI and building the new one.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface Tool {
  id: string;
  label: string;
  /** Build tool-specific content into the left panel. Return a cleanup fn or null. */
  createLeftPanel(container: HTMLElement): (() => void) | null;
  /** Build controls, action buttons, and overlays into the right panel + canvas. */
  createRightPanel(
    controlsContainer: HTMLElement,
    actionBar: HTMLElement,
    canvasContainer: HTMLElement,
  ): ToolControls;
}

export interface ToolControls {
  /** Enable or disable the primary action button. */
  setActionEnabled(enabled: boolean): void;
  /** Tear down all DOM elements and listeners created by this tool. */
  destroy(): void;
}

export interface Router {
  /** Register a tool so it can be activated by id. */
  register(tool: Tool): void;
  /** Switch to a tool by id — tears down current, builds new. */
  activate(toolId: string): void;
  /** Return the currently active tool, or null. */
  getActiveTool(): Tool | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRouter(deps: {
  nav: HTMLElement;
  leftContent: HTMLElement;
  controlsContainer: HTMLElement;
  actionBar: HTMLElement;
  canvasContainer: HTMLElement;
}): Router {
  const { nav, leftContent, controlsContainer, actionBar, canvasContainer } = deps;

  const tools = new Map<string, Tool>();
  let activeTool: Tool | null = null;
  let activeControls: ToolControls | null = null;
  let activeLeftCleanup: (() => void) | null = null;

  // ---- Nav click handler ----

  nav.addEventListener('click', (e: Event) => {
    const target = (e.target as HTMLElement).closest('.nav-item[data-tool]') as HTMLElement | null;
    if (!target) return;
    if (target.classList.contains('disabled')) return;

    const toolId = target.getAttribute('data-tool');
    if (toolId) {
      activate(toolId);
    }
  });

  // ---- Helpers ----

  /** Remove all child nodes from an element without using innerHTML. */
  function clearElement(el: HTMLElement): void {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  // ---- Public API ----

  function register(tool: Tool): void {
    tools.set(tool.id, tool);
  }

  function activate(toolId: string): void {
    const tool = tools.get(toolId);
    if (!tool) return;

    // Skip if already active
    if (activeTool?.id === toolId) return;

    // Tear down current tool
    if (activeControls) {
      activeControls.destroy();
      activeControls = null;
    }
    if (activeLeftCleanup) {
      activeLeftCleanup();
      activeLeftCleanup = null;
    }

    // Clear containers
    clearElement(leftContent);
    clearElement(controlsContainer);
    clearElement(actionBar);

    // Update nav active state
    nav.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.getAttribute('data-tool') === toolId);
    });

    // Build new tool UI
    activeLeftCleanup = tool.createLeftPanel(leftContent);
    activeControls = tool.createRightPanel(controlsContainer, actionBar, canvasContainer);
    activeTool = tool;

    // Close mobile nav and notify header
    document.body.classList.remove('nav-open');
    window.dispatchEvent(new CustomEvent('cvlt:tool-changed', {
      detail: { id: toolId, label: tool.label },
    }));
  }

  function getActiveTool(): Tool | null {
    return activeTool;
  }

  return { register, activate, getActiveTool };
}
