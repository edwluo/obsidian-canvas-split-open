const { Plugin, Notice, PluginSettingTab, Setting } = require('obsidian');

// ========================================
// Constants
// ========================================
const CONSTANTS = {
  FILE_EXTENSION: '.md',
  TEMP_FOLDER: 'temp',
  TEMP_FILE_PREFIX: 'Canvas Text Node',
  MIN_LEAF_SIZE: 50,
  CANVAS_LOAD_DELAY: 100,

  // Icon SVGs
  ICONS: {
    SPLIT: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-split-square-horizontal">
      <path d="M8 19H5c-1 0-2-1-2-2V7c0-1 1-2 2-2h3"></path>
      <path d="M16 5h3c1 0 2 1 2 2v10c0 1-1 2-2 2h-3"></path>
      <line x1="12" y1="4" x2="12" y2="20"></line>
    </svg>`,
    MAXIMIZE: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-maximize">
      <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
      <path d="M21 8V5a2 2 0 0 0-2-2h-3"></path>
      <path d="M3 16v3a2 2 0 0 0 2 2h3"></path>
      <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
    </svg>`
  },

  // Notice messages
  MESSAGES: {
    FILE_NOT_FOUND: (path) => `File not found: ${path}`,
    ONLY_MARKDOWN: 'Only Markdown files are supported',
    OPENED_IN_SPLIT: (name) => `Opened in split: ${name}`,
    OPENED_IN_TAB: (name) => `Opened in new tab: ${name}`,
    OPENED_TEXT_NODE: 'Opened text node in split',
    SELECT_ONE_NODE: 'Please select one node',
    FULLSCREEN_FILE_ONLY: 'Fullscreen open only supports file nodes',
    UNSUPPORTED_NODE: 'Unsupported node type',
    CANNOT_CREATE_SPLIT: 'Unable to create or find a split',
    CREATE_TEMP_FAILED: 'Failed to create temporary file',
    OPEN_ERROR: (msg) => `Error opening file: ${msg}`,
    OPERATION_FAILED: (msg) => `Operation failed: ${msg}`,
    SPLIT_CREATE_FAILED: 'Failed to create split, please check the current view state'
  }
};

// ========================================
// Main plugin class
// ========================================
module.exports = class CanvasSplitOpenPlugin extends Plugin {
  // ========================================
  // Lifecycle methods
  // ========================================
  async onload() {
    console.log('Loading Canvas Split Open plugin');

    await this.loadSettings();
    this.addSettingTab(new CanvasSplitOpenSettingTab(this.app, this));

    // Listen for the Canvas node context menu
    this.registerEvent(
      this.app.workspace.on('canvas:node-menu', (menu, node) => {
        this.addSplitOpenMenuItem(menu, node);
      })
    );

    // Listen for the Advanced Canvas popup menu creation event
    this.registerEvent(
      this.app.workspace.on('advanced-canvas:popup-menu-created', (canvas) => {
        this.addPopupMenuButton(canvas);
      })
    );

    // Fallback: listen directly for Canvas view changes
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf?.view?.getViewType() === 'canvas') {
          this.setupCanvasViewListener(leaf.view);
        }
      })
    );
  }

  onunload() {
    console.log('Unloading Canvas Split Open plugin');
    this.cleanupCardButtons();
  }

  // ========================================
  // Settings management
  // ========================================
  async loadSettings() {
    this.settings = Object.assign({}, {
      reuseExistingSplit: true,
      splitDirection: 'vertical',
      createNewTab: true
    }, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ========================================
  // Utility methods: node data extraction
  // ========================================
  /**
   * Extract data from a Canvas node
   * @param {Object} node - Canvas node object
   * @returns {Object} { filePath, textContent, nodeType }
   */
  extractNodeData(node) {
    let filePath = null;
    let textContent = null;
    let nodeType = null;

    // Try multiple ways to get node data
    if (node.getData) {
      const data = node.getData();
      filePath = data.file;
      textContent = data.text;
    } else {
      filePath = node.filePath || node.file;
      textContent = node.text || (node.unknownData && node.unknownData.text);
    }

    // Determine node type
    if (filePath) {
      nodeType = 'file';
    } else if (textContent) {
      nodeType = 'text';
    }

    return { filePath, textContent, nodeType };
  }

  /**
   * Validate that the file exists and is a Markdown file
   * @param {string} filePath - File path
   * @returns {Object} { valid, file, error }
   */
  validateFile(filePath) {
    const file = this.app.vault.getAbstractFileByPath(filePath);

    if (!file) {
      return {
        valid: false,
        file: null,
        error: CONSTANTS.MESSAGES.FILE_NOT_FOUND(filePath)
      };
    }

    if (!filePath.endsWith(CONSTANTS.FILE_EXTENSION)) {
      return {
        valid: false,
        file,
        error: CONSTANTS.MESSAGES.ONLY_MARKDOWN
      };
    }

    return { valid: true, file, error: null };
  }

  /**
   * Create an icon button
   * @param {string} className - Button class name
   * @param {string} label - Button label
   * @param {string} iconSvg - SVG icon
   * @param {Function} onClick - Click event handler
   * @returns {HTMLElement} Button element
   */
  createIconButton(className, label, iconSvg, onClick) {
    const button = document.createElement('button');
    button.className = `clickable-icon ${className}`;
    button.setAttribute('aria-label', label);
    button.setAttribute('data-tooltip-position', 'top');
    button.innerHTML = iconSvg;
    button.addEventListener('click', onClick);
    return button;
  }

  // ========================================
  // UI components: menus and buttons
  // ========================================

  addPopupMenuButton(canvas) {
    try {
      const popupMenuEl = canvas?.menu?.menuEl;
      if (!popupMenuEl) return;

      // Avoid adding duplicate buttons
      if (popupMenuEl.querySelector('.split-open-button')) return;

      // Create the split-open button
      const splitButton = this.createIconButton(
        'split-open-button',
        'Open in split',
        CONSTANTS.ICONS.SPLIT,
        (e) => {
          e.stopPropagation();
          this.handlePopupButtonClick(canvas, 'split');
        }
      );

      // Create the fullscreen-open button
      const fullscreenButton = this.createIconButton(
        'fullscreen-open-button',
        'Open fullscreen',
        CONSTANTS.ICONS.MAXIMIZE,
        (e) => {
          e.stopPropagation();
          this.handlePopupButtonClick(canvas, 'fullscreen');
        }
      );

      // Add buttons to the popup menu
      popupMenuEl.appendChild(splitButton);
      popupMenuEl.appendChild(fullscreenButton);
    } catch (error) {
      console.error('Error adding popup menu button:', error);
    }
  }

  setupCanvasViewListener(canvasView) {
    try {
      setTimeout(() => {
        if (canvasView?.canvas) {
          this.patchCanvasMenu(canvasView.canvas);
        }
      }, CONSTANTS.CANVAS_LOAD_DELAY);
    } catch (error) {
      console.error('Error setting up canvas view listener:', error);
    }
  }

  patchCanvasMenu(canvas) {
    if (canvas._splitOpenPatched) return;

    try {
      const originalRender = canvas.menu.render.bind(canvas.menu);
      canvas.menu.render = function(...args) {
        const result = originalRender(...args);
        this.canvas.view.app.workspace.trigger('canvas-split-open:menu-rendered', this.canvas);
        return result;
      };

      canvas._splitOpenPatched = true;

      this.registerEvent(
        this.app.workspace.on('canvas-split-open:menu-rendered', (canvas) => {
          this.addPopupMenuButton(canvas);
        })
      );
    } catch (error) {
      console.error('Error patching canvas menu:', error);
    }
  }

  cleanupCardButtons() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  async handlePopupButtonClick(canvas, mode = 'split') {
    try {
      const selectedNodes = Array.from(canvas.selection);
      if (selectedNodes.length !== 1) {
        new Notice(CONSTANTS.MESSAGES.SELECT_ONE_NODE);
        return;
      }

      const node = selectedNodes[0];
      const { filePath, textContent, nodeType } = this.extractNodeData(node);

      if (mode === 'fullscreen') {
        // Fullscreen mode only supports file nodes
        if (nodeType === 'file') {
          await this.openFileInNewTab(filePath);
        } else {
          new Notice(CONSTANTS.MESSAGES.FULLSCREEN_FILE_ONLY);
        }
      } else {
        // Split mode supports both file and text nodes
        if (nodeType === 'file') {
          await this.openFileInSplit(filePath);
        } else if (nodeType === 'text') {
          await this.openTextInSplit(textContent, node.id);
        } else {
          new Notice(CONSTANTS.MESSAGES.UNSUPPORTED_NODE);
        }
      }
    } catch (error) {
      console.error('Error handling popup button click:', error);
      new Notice(CONSTANTS.MESSAGES.OPERATION_FAILED(error.message));
    }
  }

  addSplitOpenMenuItem(menu, node) {
    const { filePath, textContent, nodeType } = this.extractNodeData(node);

    if (!nodeType) return;

    // Add the "Open in split" option
    menu.addItem((item) => {
      item
        .setTitle('Open in split')
        .setIcon('split')
        .onClick(async () => {
          if (nodeType === 'file') {
            await this.openFileInSplit(filePath);
          } else if (nodeType === 'text') {
            await this.openTextInSplit(textContent, node.id);
          }
        });
    });

    // Only add the "Open fullscreen" option for file nodes
    if (nodeType === 'file') {
      menu.addItem((item) => {
        item
          .setTitle('Open fullscreen')
          .setIcon('maximize')
          .onClick(async () => {
            await this.openFileInNewTab(filePath);
          });
      });
    }
  }

  // ========================================
  // File opening logic
  // ========================================

  async openFileInNewTab(filePath) {
    try {
      const { valid, file, error } = this.validateFile(filePath);
      if (!valid) {
        new Notice(error);
        return;
      }

      const newLeaf = this.app.workspace.getLeaf('tab');
      await newLeaf.openFile(file);
      this.app.workspace.setActiveLeaf(newLeaf, { focus: true });

      new Notice(CONSTANTS.MESSAGES.OPENED_IN_TAB(file.basename));
    } catch (error) {
      console.error('Error opening file in new tab:', error);
      new Notice(CONSTANTS.MESSAGES.OPEN_ERROR(error.message));
    }
  }

  async openFileInSplit(filePath) {
    try {
      const { valid, file, error } = this.validateFile(filePath);
      if (!valid) {
        new Notice(error);
        return;
      }

      const targetSplit = this.getOrCreateSplitLeaf();
      if (!targetSplit) {
        new Notice(CONSTANTS.MESSAGES.CANNOT_CREATE_SPLIT);
        return;
      }

      const targetLeaf = this.getTargetLeafForSplit(targetSplit);
      await targetLeaf.openFile(file);

      if (targetLeaf !== targetSplit && targetLeaf.parentSplit) {
        this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
      }

      new Notice(CONSTANTS.MESSAGES.OPENED_IN_SPLIT(file.basename));
    } catch (error) {
      console.error('Error opening file in split:', error);
      new Notice(CONSTANTS.MESSAGES.OPEN_ERROR(error.message));
    }
  }

  async openTextInSplit(text, nodeId) {
    try {
      const tempFile = await this.createOrUpdateTempFile(text, nodeId);
      if (!tempFile) {
        new Notice(CONSTANTS.MESSAGES.CREATE_TEMP_FAILED);
        return;
      }

      const targetSplit = this.getOrCreateSplitLeaf();
      if (!targetSplit) {
        new Notice(CONSTANTS.MESSAGES.CANNOT_CREATE_SPLIT);
        return;
      }

      const targetLeaf = this.getTargetLeafForSplit(targetSplit);
      await targetLeaf.openFile(tempFile);

      if (targetLeaf !== targetSplit && targetLeaf.parentSplit) {
        this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
      }

      new Notice(CONSTANTS.MESSAGES.OPENED_TEXT_NODE);
    } catch (error) {
      console.error('Error opening text in split:', error);
      new Notice(CONSTANTS.MESSAGES.OPEN_ERROR(error.message));
    }
  }

  /**
   * Get or create the target leaf for split opening
   * @param {WorkspaceLeaf} targetSplit - Target split
   * @returns {WorkspaceLeaf} Leaf used to open the file
   */
  getTargetLeafForSplit(targetSplit) {
    // If the split already has a file and the setting is to create a new tab
    if (targetSplit.view && targetSplit.view.file && this.settings.createNewTab !== false) {
      const parentSplit = targetSplit.parentSplit;
      if (parentSplit) {
        const newLeaf = this.app.workspace.createLeafInParent(parentSplit, -1);
        newLeaf._canvasSplitOpen = true;
        return newLeaf;
      }
    }
    return targetSplit;
  }

  /**
   * Create or update the temporary file
   * @param {string} text - Text content
   * @param {string} nodeId - Node ID
   * @returns {Promise<TFile|null>} Temporary file
   */
  async createOrUpdateTempFile(text, nodeId) {
    try {
      const tempFileName = `${CONSTANTS.TEMP_FILE_PREFIX} ${nodeId}${CONSTANTS.FILE_EXTENSION}`;
      const tempFilePath = `${CONSTANTS.TEMP_FOLDER}/${tempFileName}`;

      let tempFile = this.app.vault.getAbstractFileByPath(tempFilePath);

      if (!tempFile) {
        const tempFolder = this.app.vault.getAbstractFileByPath(CONSTANTS.TEMP_FOLDER);
        if (!tempFolder) {
          await this.app.vault.createFolder(CONSTANTS.TEMP_FOLDER);
        }
        tempFile = await this.app.vault.create(tempFilePath, text);
      } else {
        await this.app.vault.modify(tempFile, text);
      }

      return tempFile;
    } catch (error) {
      console.error('Error creating temp file:', error);
      return null;
    }
  }

  // ========================================
  // Smart split management
  // ========================================

  /**
   * Smart split management: prefer reusing an existing split to avoid creating too many splits
   * @returns {WorkspaceLeaf|null} Target split
   */
  getOrCreateSplitLeaf() {
    const workspace = this.app.workspace;

    if (this.settings.reuseExistingSplit) {
      // 1. Look for an already-created split
      const existingSplit = this.findExistingSplitLeaf();
      if (existingSplit && this.isLeafUsable(existingSplit)) {
        return existingSplit;
      }

      // 2. Look for another available split
      const otherSplit = this.findAnyOtherLeaf();
      if (otherSplit && this.isLeafUsable(otherSplit)) {
        otherSplit._canvasSplitOpen = true;
        return otherSplit;
      }
    }

    // 3. Create a new split
    return this.createNewSplit(workspace);
  }

  /**
   * Create a new split
   * @param {Workspace} workspace - Workspace object
   * @returns {WorkspaceLeaf|null} Newly created split
   */
  createNewSplit(workspace) {
    try {
      const direction = this.settings.splitDirection;
      const newLeaf = workspace.splitActiveLeaf(direction);

      if (newLeaf) {
        newLeaf._canvasSplitOpen = true;
      }

      return newLeaf;
    } catch (error) {
      console.error('Error creating split:', error);
      new Notice(CONSTANTS.MESSAGES.SPLIT_CREATE_FAILED);
      return null;
    }
  }

  /**
   * Check whether a split is usable
   * @param {WorkspaceLeaf} leaf - Split to check
   * @returns {boolean} Whether it is usable
   */
  isLeafUsable(leaf) {
    if (!leaf || !leaf.containerEl) return false;

    const workspace = this.app.workspace;
    const allLeaves = workspace.getLeavesOfType('markdown');
    if (!allLeaves.includes(leaf)) return false;

    const rect = leaf.containerEl.getBoundingClientRect();
    const hasValidSize = rect.width > CONSTANTS.MIN_LEAF_SIZE && rect.height > CONSTANTS.MIN_LEAF_SIZE;
    const isInDOM = document.contains(leaf.containerEl);
    const isMarkedLeaf = leaf._canvasSplitOpen;

    if (!isInDOM) return false;

    // Relax the size requirement for marked leaves
    if (!hasValidSize && !isMarkedLeaf) return false;

    // Avoid reusing the currently active split
    if (leaf === workspace.activeLeaf) return false;

    return true;
  }

  /**
   * Find all related leaf nodes in the same split group
   * @param {Array<WorkspaceLeaf>} markedLeaves - List of marked leaves
   * @returns {Array<WorkspaceLeaf>} All leaves in the same group
   */
  findAllLeavesInSameSplitGroup(markedLeaves) {
    const allGroupLeaves = new Set(markedLeaves);

    for (const markedLeaf of markedLeaves) {
      const parentSplit = markedLeaf.parentSplit;
      if (parentSplit && parentSplit.children) {
        parentSplit.children.forEach(child => {
          if (child.view && child.view.getViewType() === 'markdown') {
            allGroupLeaves.add(child);
            if (!child._canvasSplitOpen) {
              child._canvasSplitOpen = true;
            }
          }
        });
      }
    }

    return Array.from(allGroupLeaves);
  }

  /**
   * Find an existing split created by us
   * @returns {WorkspaceLeaf|null} The found split
   */
  findExistingSplitLeaf() {
    try {
      const activeLeaf = this.app.workspace.activeLeaf;
      const allMarkdownLeaves = this.app.workspace.getLeavesOfType('markdown');

      const markedLeaves = allMarkdownLeaves.filter(leaf => {
        if (!leaf._canvasSplitOpen || leaf === activeLeaf) return false;
        if (leaf.view?.file?.path?.includes('.canvas')) return false;
        if (!leaf.view || leaf.view.getViewType() !== 'markdown') return false;

        const leafContainer = leaf.containerEl;
        if (!leafContainer || !leafContainer.closest('.workspace-split.mod-root')) {
          return false;
        }

        return true;
      });

      if (markedLeaves.length > 0) {
        const allGroupLeaves = this.findAllLeavesInSameSplitGroup(markedLeaves);
        return allGroupLeaves[0];
      }
    } catch (error) {
      console.error('Error finding existing split:', error);
    }

    return null;
  }

  /**
   * Find any other available leaf
   * @returns {WorkspaceLeaf|null} The found split
   */
  findAnyOtherLeaf() {
    try {
      const activeLeaf = this.app.workspace.activeLeaf;
      const allLeaves = this.app.workspace.getLeavesOfType('markdown');

      const otherLeaves = allLeaves.filter(leaf => {
        if (leaf === activeLeaf) return false;
        if (leaf.view?.file?.path?.includes('.canvas')) return false;
        if (!leaf.view || leaf.view.getViewType() !== 'markdown') return false;

        const leafContainer = leaf.containerEl;
        if (!leafContainer || !leafContainer.closest('.workspace-split.mod-root')) {
          return false;
        }

        return true;
      });

      return otherLeaves.length > 0 ? otherLeaves[0] : null;
    } catch (error) {
      console.error('Error finding other split:', error);
    }

    return null;
  }

};

// ========================================
// Settings page
// ========================================
class CanvasSplitOpenSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Canvas Split Open Settings' });

    new Setting(containerEl)
      .setName('Reuse existing split')
      .setDesc('When enabled, new files are opened in an existing split first instead of creating a new one')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.reuseExistingSplit)
        .onChange(async (value) => {
          this.plugin.settings.reuseExistingSplit = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Split direction')
      .setDesc('Choose the direction to use when creating a new split')
      .addDropdown(dropdown => dropdown
        .addOption('vertical', 'Vertical split (left/right)')
        .addOption('horizontal', 'Horizontal split (top/bottom)')
        .setValue(this.plugin.settings.splitDirection)
        .onChange(async (value) => {
          this.plugin.settings.splitDirection = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Create new tab')
      .setDesc('When enabled, opening a new file in an existing split creates a new tab instead of replacing the current file')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.createNewTab !== false)
        .onChange(async (value) => {
          this.plugin.settings.createNewTab = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Usage' });
    containerEl.createEl('p', {
      text: 'Select a file node or text node in the Canvas, then:'
    });

    const usageList = containerEl.createEl('ul');
    usageList.createEl('li', { text: 'Choose "Open in split" or "Open fullscreen" (file nodes only) from the right-click menu' });
    usageList.createEl('li', { text: 'Or click the split icon or fullscreen icon in the card hover menu' });

    containerEl.createEl('h4', { text: 'Features' });
    const featureList = containerEl.createEl('ul');
    featureList.createEl('li', { text: 'Open in split: opens the note in a split while keeping the Canvas visible' });
    featureList.createEl('li', { text: 'Open fullscreen: opens the note in a new tab (file nodes only)' });
  }
}
