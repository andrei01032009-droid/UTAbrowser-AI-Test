// Простое JSON-хранилище (файл = одна "таблица").
// Используется для пользователей и сессий. Для прототипа этого достаточно.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

class Store {
  constructor(file) {
    this.file = path.join(DATA_DIR, file);
    this.data = this.load();
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  save() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  del(key) {
    delete this.data[key];
    this.save();
  }

  all() {
    return this.data;
  }
}

module.exports = Store;
