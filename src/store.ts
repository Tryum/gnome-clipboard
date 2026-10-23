import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as log from './log.js';

export class Store {
  private _path: string = "";
  private _imagesDir: string = "";

  constructor(dir: string) {
    // Make sure path exists
    let ret = GLib.mkdir_with_parents(dir, parseInt('0700', 8))
    if (ret == 0) {
      this._path = GLib.build_filenamev([dir, "history.json"]);
      this._imagesDir = GLib.build_filenamev([dir, "images"]);
      GLib.mkdir_with_parents(this._imagesDir, parseInt('0700', 8));
      log.info(`store location set to ${this._path}`);
    } else {
      log.error(`unable to create store directory: ${dir}`);
    }
  }

  public path(): string {
    return this._path;
  }

  async load(): Promise<any> {
    log.info(`loading history async from ${this._path}`);

    try {
      let file = Gio.file_new_for_path(this._path);
      if (!file.query_exists(null)) {
          return [];
      }
      
      const result = await new Promise<any>((resolve, reject) => {
        file.load_contents_async(null, (file: any, res: any) => {
            try {
                resolve(file.load_contents_finish(res));
            } catch (e) {
                reject(e);
            }
        });
      });

      // GJS returns the method's return value together with its out
      // parameters: [ok: boolean, contents: Uint8Array, etag: string].
      // The old code assumed [contents, etag], so it fed the boolean `true`
      // to the decoder -- `new Uint8Array(true)` is a single NUL byte -- and
      // every startup ended in "JSON parse failed" with the history dropped.
      // Accept the two-value form too, for older GJS releases.
      let ok = true;
      let contents: any;
      if (Array.isArray(result)) {
        if (result[0] instanceof Uint8Array) {
          contents = result[0];
        } else {
          ok = result[0] !== false;
          contents = result[1];
        }
      } else {
        contents = result;
      }

      if (!ok || !contents) {
        return [];
      }

      let text = this._safeDecode(contents);
      if (text && text.trim().length > 0) {
          // Remove Byte Order Mark (BOM) if present
          text = text.replace(/^\uFEFF/, '').trim();
          try {
              return JSON.parse(text);
          } catch (e) {
              log.error(`JSON parse failed for ${this._path}: ${e}`);
              this._preserveUnreadable();
              return [];
          }
      }
    } catch (err) {
      log.error(`load history failed: ${err}`);
    }

    return [];
  }

  // Never let one bad read silently destroy the user's history: keep a copy
  // next to the original before the next save overwrites it.
  private _preserveUnreadable(): void {
    try {
      const backup = `${this._path}.corrupt-${Date.now()}`;
      Gio.File.new_for_path(this._path).copy(
        Gio.File.new_for_path(backup), Gio.FileCopyFlags.NONE, null, null);
      log.warn(`kept unreadable history at ${backup}`);
    } catch (e) {
      log.warn(`could not back up unreadable history: ${e}`);
    }
  }

  private _safeDecode(data: any): string {
      if (!data) return "";
      try {
          // Robust wrapper for GJS binary data
          const ui8 = (data instanceof Uint8Array) ? data : new Uint8Array(data);
          return new TextDecoder().decode(ui8);
      } catch (e) {
          log.warn(`TextDecoder failed, using byte fallback: ${e}`);
          let text = "";
          let bytes = data;
          if (data && typeof data.get_data === 'function') {
              bytes = data.get_data();
          }
          if (bytes && bytes.length) {
              for (let i = 0; i < bytes.length; i++) {
                  text += String.fromCharCode(bytes[i]);
              }
          }
          return text;
      }
  }

  async save(history: any) {
    try {
      let json = JSON.stringify(history);
      let file = Gio.file_new_for_path(this._path);
      const bytes = GLib.Bytes.new(new TextEncoder().encode(json));
      
      await new Promise<void>((resolve, reject) => {
        file.replace_contents_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (file: any, res: any) => {
            try {
                file.replace_contents_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
      });
    } catch (err) {
      log.error(`save history failed: ${err}`);
    }
  }

  async saveImage(id: number, bytes: any): Promise<string | null> {
    let filename = `${id}.png`;
    let path = GLib.build_filenamev([this._imagesDir, filename]);
    try {
      let file = Gio.file_new_for_path(path);
      
      await new Promise<void>((resolve, reject) => {
        file.replace_contents_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (file: any, res: any) => {
            try {
                file.replace_contents_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
      });
      return path;
    } catch (err) {
      log.error(`failed to save image: ${err}`);
      return null;
    }
  }

  deleteImage(path: string) {
    try {
      let file = Gio.file_new_for_path(path);
      file.delete(null);
    } catch (err) {
      log.error(`failed to delete image: ${err}`);
    }
  }
}
