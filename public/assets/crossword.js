// Клиентский компонент сетки кроссворда. Работает со «скелетом»:
// rows/cols и список слов {index, number, row, col, dir, len, clue}.
// Буквы ответов в клиенте отсутствуют — проверка только через /api/check.

export class CrosswordBoard {
  /**
   * @param {HTMLElement} boardEl  контейнер сетки
   * @param {Object} skeleton      публичный скелет с сервера
   * @param {{letters: Object, onChange?: Function}} state  буквы по клеткам "r,c"
   */
  constructor(boardEl, skeleton, state) {
    this.board = boardEl;
    this.sk = skeleton;
    this.letters = state.letters;
    this.onChange = state.onChange || (() => {});
    this.cells = new Map();     // "r,c" -> {el, placements:[...]}
    this.placements = skeleton.words;
    this.active = new Set();
    for (const p of this.placements) {
      const [dr, dc] = p.dir === 'h' ? [0, 1] : [1, 0];
      for (let i = 0; i < p.len; i++) {
        const k = (p.row + dr * i) + ',' + (p.col + dc * i);
        this.active.add(k);
        if (!this.cells.has(k)) this.cells.set(k, { el: null, placements: [] });
        this.cells.get(k).placements.push({ p, i });
      }
    }
    this.current = null;        // выбранное размещение
    this.pos = 0;               // позиция курсора в слове
    this.render();
  }

  render() {
    this.board.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'cw-grid';
    grid.style.gridTemplateColumns = `repeat(${this.sk.cols}, var(--cell, 34px))`;

    // Автоподбор размера клетки под ширину экрана
    const fit = () => {
      const avail = Math.min(this.board.clientWidth - 8, 640);
      const size = Math.max(24, Math.min(40, Math.floor((avail - this.sk.cols * 2) / this.sk.cols)));
      grid.style.setProperty('--cell', size + 'px');
    };
    fit();
    window.removeEventListener('resize', this._fit);
    this._fit = fit;
    window.addEventListener('resize', fit);

    // Номер — только в стартовой клетке слова (если в одной клетке начинаются
    // два слова, показываем общий номер: нумерация сервера им уже назначила один)
    const startNumbers = new Map();
    for (const p of this.placements) {
      const sk = p.row + ',' + p.col;
      const cur = startNumbers.get(sk);
      startNumbers.set(sk, cur === undefined ? p.number : Math.min(cur, p.number));
    }

    for (let r = 0; r < this.sk.rows; r++) {
      for (let c = 0; c < this.sk.cols; c++) {
        const k = r + ',' + c;
        const cell = document.createElement('div');
        cell.className = 'cw-cell';
        if (!this.active.has(k)) {
          cell.dataset.inactive = '1';
        } else {
          const info = this.cells.get(k);
          const num = startNumbers.get(k);
          if (num) {
            const n = document.createElement('span');
            n.className = 'num';
            n.textContent = num;
            cell.appendChild(n);
          }
          const letter = document.createElement('span');
          letter.className = 'letter';
          letter.textContent = this.letters[k] || '';
          cell.appendChild(letter);
          cell.tabIndex = 0;
          cell.setAttribute('role', 'textbox');
          cell.setAttribute('aria-label', `Клетка ${r + 1}, ${c + 1}`);
          cell.addEventListener('click', () => this.onCellClick(k));
          info.el = cell;
        }
        grid.appendChild(cell);
      }
    }
    this.board.appendChild(grid);
    this.grid = grid;
  }

  // Клетка -> выбор слова: если клетка в двух словах, переключаем направление
  onCellClick(k) {
    const info = this.cells.get(k);
    const words = info.placements.map(x => x.p);
    let target = null;
    if (this.current && words.includes(this.current) && words.length > 1) {
      target = words.find(p => p !== this.current);
    } else if (words.includes(this.current)) {
      target = this.current;
    } else {
      target = words[0];
    }
    const inWord = info.placements.find(x => x.p === target);
    this.select(target, inWord.i);
  }

  select(p, pos) {
    this.current = p;
    this.pos = pos ?? 0;
    this.paint();
  }

  paint() {
    for (const [, info] of this.cells) {
      info.el?.classList.remove('in-word', 'current', 'word-ok', 'word-bad');
    }
    if (!this.current) return;
    const [dr, dc] = this.current.dir === 'h' ? [0, 1] : [1, 0];
    for (let i = 0; i < this.current.len; i++) {
      const k = (this.current.row + dr * i) + ',' + (this.current.col + dc * i);
      this.cells.get(k)?.el?.classList.add('in-word');
    }
    const ck = (this.current.row + dr * this.pos) + ',' + (this.current.col + dc * this.pos);
    this.cells.get(ck)?.el?.classList.add('current');
  }

  // Ввод буквы в текущую позицию, авто-переход вперёд
  inputLetter(ch) {
    if (!this.current) return false;
    const norm = ch.toUpperCase().replace('Ё', 'Е');
    if (!/^[А-Я0-9]$/.test(norm)) return false;
    const [dr, dc] = this.current.dir === 'h' ? [0, 1] : [1, 0];
    const k = (this.current.row + dr * this.pos) + ',' + (this.current.col + dc * this.pos);
    this.letters[k] = norm;
    this.cells.get(k).el.querySelector('.letter').textContent = norm;
    if (this.pos < this.current.len - 1) this.pos++;
    this.paint();
    this.onChange();
    return true;
  }

  erase(forward = false) {
    if (!this.current) return;
    const [dr, dc] = this.current.dir === 'h' ? [0, 1] : [1, 0];
    const k = (this.current.row + dr * this.pos) + ',' + (this.current.col + dc * this.pos);
    if (this.letters[k]) {
      delete this.letters[k];
      this.cells.get(k).el.querySelector('.letter').textContent = '';
    } else if (!forward && this.pos > 0) {
      this.pos--;
      this.erase(false);
      return;
    }
    this.paint();
    this.onChange();
  }

  move(dr, dc) {
    if (!this.current) return;
    const [wdr, wdc] = this.current.dir === 'h' ? [0, 1] : [1, 0];
    if ((wdr === -dr && wdc === -dc) || (dr === wdr && dc === wdc)) {
      // движение вдоль слова
      this.pos = Math.max(0, Math.min(this.current.len - 1, this.pos + (dr === wdr && dc === wdc ? 1 : -1)));
    } else {
      // перпендикулярное движение — перескакиваем на пересекающее слово
      const [cr, cc] = [this.current.row + wdr * this.pos, this.current.col + wdc * this.pos];
      let nr = cr + dr, nc = cc + dc;
      while (nr >= 0 && nr < this.sk.rows && nc >= 0 && nc < this.sk.cols) {
        const info = this.cells.get(nr + ',' + nc);
        if (info) {
          const other = info.placements.find(x => x.p !== this.current) || info.placements[0];
          this.select(other.p, other.i);
          return;
        }
        nr += dr; nc += dc;
      }
    }
    this.paint();
  }

  // Tab / Shift+Tab: следующее/предыдущее слово по номеру
  cycleWord(back = false) {
    const list = [...this.placements].sort((a, b) => a.number - b.number);
    if (list.length === 0) return;
    let idx = list.findIndex(p => p === this.current);
    idx = ((idx < 0 ? 0 : idx + (back ? -1 : 1)) + list.length) % list.length;
    this.select(list[idx], 0);
  }

  // Обработка клавиатуры; возвращает true, если событие поглощено
  handleKey(e) {
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const handled = this.inputLetter(e.key);
      // Буква уже введена здесь — запрещаем браузеру дублировать её в скрытый input
      if (handled) e.preventDefault();
      return handled;
    }
    switch (e.key) {
      case 'Backspace': e.preventDefault(); this.erase(false); return true;
      case 'Delete': e.preventDefault(); this.erase(true); return true;
      case 'ArrowLeft': e.preventDefault(); this.move(0, -1); return true;
      case 'ArrowRight': e.preventDefault(); this.move(0, 1); return true;
      case 'ArrowUp': e.preventDefault(); this.move(-1, 0); return true;
      case 'ArrowDown': e.preventDefault(); this.move(1, 0); return true;
      case 'Tab': e.preventDefault(); this.cycleWord(e.shiftKey); return true;
      case ' ': e.preventDefault(); this.onCellClick(this.currentKey()); return true;
    }
    return false;
  }

  currentKey() {
    if (!this.current) return null;
    const [dr, dc] = this.current.dir === 'h' ? [0, 1] : [1, 0];
    return (this.current.row + dr * this.pos) + ',' + (this.current.col + dc * this.pos);
  }

  // Подсветка результата проверки: только целые слова (верно/неверно)
  paintResults(results) {
    this.clearResults();
    for (const r of results) {
      if (r.correct === null) continue;
      const p = this.placements.find(x => x.index === r.index);
      if (!p) continue;
      const [dr, dc] = p.dir === 'h' ? [0, 1] : [1, 0];
      for (let i = 0; i < p.len; i++) {
        const el = this.cells.get((p.row + dr * i) + ',' + (p.col + dc * i))?.el;
        el?.classList.add(r.correct ? 'word-ok' : 'word-bad');
      }
    }
  }

  clearResults() {
    for (const [, info] of this.cells) info.el?.classList.remove('word-ok', 'word-bad');
  }

  // Заполнить клетку (подсказка с сервера)
  setCell(k, ch) {
    this.letters[k] = ch;
    this.cells.get(k)?.el?.querySelector('.letter')?.replaceChildren(ch);
  }
}
