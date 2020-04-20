import { WebGLRenderer, Color } from 'three';
import Scene from 'core/Scene';
import Display, { resetDisplayCount } from 'core/Display';
import { Composer, CanvasBuffer, GLBuffer } from 'graphics';
import * as displayLibrary from 'displays';
import * as effectsLibrary from 'effects';
import { logger, raiseError, events } from 'view/global';
import { CANVAS_WIDTH, CANVAS_HEIGHT, DISPLAY_TYPE_STAGE } from 'view/constants';
import { insert, remove, swap } from 'utils/array';

export default class Stage extends Display {
  static label = 'Stage';

  static className = 'Stage';

  static defaultProperties = {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    zoom: 1.0,
    backgroundColor: '#000000',
  };

  constructor(properties) {
    super(Stage, properties);

    this.scenes = [];
    this.initialized = false;

    Object.defineProperty(this, 'type', { value: DISPLAY_TYPE_STAGE });
  }

  init(canvas) {
    if (this.initialized) {
      return;
    }

    const { width, height, backgroundColor } = this.properties;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      premultipliedAlpha: true,
      alpha: false,
    });

    this.renderer.setSize(width, height);
    this.renderer.autoClear = false;

    this.composer = new Composer(this.renderer);

    this.canvasBuffer = new CanvasBuffer(width, height);
    this.glBuffer = new GLBuffer(width, height);

    this.backgroundColor = new Color(backgroundColor);

    this.initialized = true;
  }

  update(properties) {
    const changed = super.update(properties);

    if (changed) {
      if (properties.width !== undefined || properties.height !== undefined) {
        this.setSize(this.properties.width, this.properties.height);
      }

      if (properties.backgroundColor !== undefined) {
        this.backgroundColor.set(properties.backgroundColor);
      }
    }

    return changed;
  }

  getScene(id) {
    return this.scenes.find(n => n.id === id);
  }

  getElementById(id) {
    return this.scenes.reduce((element, scene) => {
      if (!element) {
        element = scene.getElementById(id);
      }
      return element;
    }, this.getScene(id));
  }

  removeElement(obj) {
    if (obj instanceof Scene) {
      this.removeScene(obj);
    } else {
      const scene = this.getScene(obj.scene.id);
      if (scene) {
        scene.removeElement(obj);
      }
    }
  }

  getImage(callback, format) {
    const img = this.renderer.domElement.toDataURL(format || 'image/png');
    const base64 = img.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');

    if (callback) callback(buffer);
  }

  getSize() {
    if (this.composer) {
      return this.composer.getSize();
    }

    return { width: 0, height: 0 };
  }

  setSize(width, height) {
    this.scenes.forEach(scene => {
      scene.setSize(width, height);
    });

    this.composer.setSize(width, height);

    this.canvasBuffer.setSize(width, height);
    this.glBuffer.setSize(width, height);

    events.emit('stage-resize');
  }

  addScene(scene = new Scene(), index) {
    if (index !== undefined) {
      insert(this.scenes, index, scene);
    } else {
      this.scenes.push(scene);
    }

    scene.stage = this;

    if (scene.addToStage) {
      scene.addToStage(this);
    }

    this.changed = true;

    return scene;
  }

  removeScene(scene) {
    remove(this.scenes, scene);

    scene.stage = null;

    scene.removeFromStage(this);

    this.changed = true;
  }

  shiftScene(scene, i) {
    const index = this.scenes.indexOf(scene);

    swap(this.scenes, index, index + i);

    this.changed = this.scenes.indexOf(scene) !== index;

    return this.changed;
  }

  clearScenes() {
    [...this.scenes].forEach(scene => this.removeScene(scene));

    resetDisplayCount();

    this.changed = true;
  }

  getSceneData() {
    return this.scenes.map(scene => scene.toJSON());
  }

  hasScenes() {
    return this.scenes.length > 0;
  }

  hasChanges() {
    if (this.changed) {
      return true;
    }

    let changes = false;

    this.scenes.forEach(scene => {
      if (!changes && scene.hasChanges()) {
        changes = true;
      }
    });

    return changes;
  }

  resetChanges() {
    this.changed = false;

    this.scenes.forEach(scene => {
      scene.resetChanges();
    });
  }

  setZoom(val) {
    const { zoom } = this.properties;

    if (val > 0) {
      if (zoom < 1.0) {
        this.update({ zoom: zoom + 0.25 });
      }
    } else if (val < 0) {
      if (zoom > 0.25) {
        this.update({ zoom: zoom - 0.25 });
      }
    } else {
      this.update({ zoom: 1.0 });
    }

    events.emit('zoom');
  }

  loadConfig(config) {
    if (typeof config === 'object') {
      this.clearScenes();

      if (config.scenes) {
        config.scenes.forEach(scene => {
          const newScene = new Scene(scene.properties);

          this.addScene(newScene);

          const loadReactors = (reactors, element) => {
            Object.keys(reactors).forEach(key => {
              element.setReactor(key, reactors[key]);
            });
          };

          const loadComponent = (lib, { name, properties, reactors }) => {
            const Component = lib[name];

            if (Component) {
              const element = newScene.addElement(new Component(properties));
              if (reactors) {
                loadReactors(reactors, element);
              }
            } else {
              logger.warn('Component not found:', name);
            }
          };

          if (scene.displays) {
            scene.displays.forEach(display => loadComponent(displayLibrary, display));
          }

          if (scene.effects) {
            scene.effects.forEach(effect => loadComponent(effectsLibrary, effect));
          }

          if (scene.reactors) {
            loadReactors(scene.reactors, newScene);
          }
        });
      }

      if (config.stage) {
        this.update(config.stage.properties);
      } else {
        this.update(Stage.defaultProperties);
      }
    } else {
      raiseError('Invalid project data.');
    }
  }

  toJSON() {
    const { id, name, type, properties } = this;

    return {
      id,
      name,
      type,
      properties: { ...properties },
    };
  }

  renderScene(scene, data) {
    const buffer = scene.render(data);

    this.composer.blendBuffer(buffer, { ...scene.properties });
  }

  render(data) {
    const { composer, scenes } = this;

    composer.clear(this.backgroundColor, 1);

    scenes.forEach(scene => {
      if (scene.properties.enabled) {
        this.renderScene(scene, data);
      }
    });

    composer.renderToScreen();
  }
}