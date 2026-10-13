export interface ListItem<T> {
  prev: ListItem<T> | null;
  next: ListItem<T> | null;
  data: T;
}

interface Cursor<T> {
  prev: ListItem<T> | null;
  next: ListItem<T> | null;
  cursor: Cursor<T> | null;
}

type Callback<T, R> = (this: any, data: T, item: ListItem<T>, list: List<T>) => R;

let releasedCursors: Cursor<any> | null = null;

/** css-tree's doubly linked list, which keeps iterating correctly while its items are removed. */
export class List<T = any> {
  head: ListItem<T> | null = null;
  tail: ListItem<T> | null = null;
  cursor: Cursor<T> | null = null;

  static createItem<T>(data: T): ListItem<T> {
    return { prev: null, next: null, data };
  }

  createItem(data: T): ListItem<T> {
    return List.createItem(data);
  }

  allocateCursor(prev: ListItem<T> | null, next: ListItem<T> | null): Cursor<T> {
    let cursor: Cursor<T>;
    if (releasedCursors !== null) {
      cursor = releasedCursors;
      releasedCursors = releasedCursors.cursor;
      cursor.prev = prev;
      cursor.next = next;
      cursor.cursor = this.cursor;
    } else {
      cursor = { prev, next, cursor: this.cursor };
    }
    this.cursor = cursor;
    return cursor;
  }

  releaseCursor(): void {
    const cursor = this.cursor!;
    this.cursor = cursor.cursor;
    cursor.prev = null;
    cursor.next = null;
    cursor.cursor = releasedCursors;
    releasedCursors = cursor;
  }

  updateCursors(prevOld: ListItem<T> | null, prevNew: ListItem<T> | null, nextOld?: ListItem<T> | null, nextNew?: ListItem<T> | null): void {
    for (let cursor = this.cursor; cursor !== null; cursor = cursor.cursor) {
      if (cursor.prev === prevOld) cursor.prev = prevNew;
      if (cursor.next === nextOld) cursor.next = nextNew!;
    }
  }

  *[Symbol.iterator](): IterableIterator<T> {
    for (let cursor = this.head; cursor !== null; cursor = cursor.next) yield cursor.data;
  }

  get size(): number {
    let size = 0;
    for (let cursor = this.head; cursor !== null; cursor = cursor.next) size++;
    return size;
  }

  get isEmpty(): boolean {
    return this.head === null;
  }

  get first(): T | null {
    return this.head && this.head.data;
  }

  get last(): T | null {
    return this.tail && this.tail.data;
  }

  fromArray(array: Iterable<T>): this {
    let cursor: ListItem<T> | null = null;
    this.head = null;
    for (const data of array) {
      const item = List.createItem(data);
      if (cursor !== null) cursor.next = item;
      else this.head = item;
      item.prev = cursor;
      cursor = item;
    }
    this.tail = cursor;
    return this;
  }

  toArray(): T[] {
    return [...this];
  }

  toJSON(): T[] {
    return [...this];
  }

  forEach(fn: Callback<T, void>, thisArg: any = this): void {
    const cursor = this.allocateCursor(null, this.head);
    while (cursor.next !== null) {
      const item = cursor.next;
      cursor.next = item.next;
      fn.call(thisArg, item.data, item, this);
    }
    this.releaseCursor();
  }

  forEachRight(fn: Callback<T, void>, thisArg: any = this): void {
    const cursor = this.allocateCursor(this.tail, null);
    while (cursor.prev !== null) {
      const item = cursor.prev;
      cursor.prev = item.prev;
      fn.call(thisArg, item.data, item, this);
    }
    this.releaseCursor();
  }

  reduce<R>(fn: (this: any, acc: R, data: T, item: ListItem<T>, list: List<T>) => R, initialValue: R, thisArg: any = this): R {
    const cursor = this.allocateCursor(null, this.head);
    let acc = initialValue;
    while (cursor.next !== null) {
      const item = cursor.next;
      cursor.next = item.next;
      acc = fn.call(thisArg, acc, item.data, item, this);
    }
    this.releaseCursor();
    return acc;
  }

  reduceRight<R>(fn: (this: any, acc: R, data: T, item: ListItem<T>, list: List<T>) => R, initialValue: R, thisArg: any = this): R {
    const cursor = this.allocateCursor(this.tail, null);
    let acc = initialValue;
    while (cursor.prev !== null) {
      const item = cursor.prev;
      cursor.prev = item.prev;
      acc = fn.call(thisArg, acc, item.data, item, this);
    }
    this.releaseCursor();
    return acc;
  }

  some(fn: Callback<T, unknown>, thisArg: any = this): boolean {
    for (let cursor = this.head; cursor !== null; cursor = cursor.next) {
      if (fn.call(thisArg, cursor.data, cursor, this)) return true;
    }
    return false;
  }

  map<R>(fn: Callback<T, R>, thisArg: any = this): List<R> {
    const result = new List<R>();
    for (let cursor = this.head; cursor !== null; cursor = cursor.next) result.appendData(fn.call(thisArg, cursor.data, cursor, this));
    return result;
  }

  filter(fn: Callback<T, unknown>, thisArg: any = this): List<T> {
    const result = new List<T>();
    for (let cursor = this.head; cursor !== null; cursor = cursor.next) {
      if (fn.call(thisArg, cursor.data, cursor, this)) result.appendData(cursor.data);
    }
    return result;
  }

  nextUntil(start: ListItem<T> | null, fn: Callback<T, unknown>, thisArg: any = this): void {
    if (start === null) return;
    const cursor = this.allocateCursor(null, start);
    while (cursor.next !== null) {
      const item = cursor.next;
      cursor.next = item.next;
      if (fn.call(thisArg, item.data, item, this)) break;
    }
    this.releaseCursor();
  }

  prevUntil(start: ListItem<T> | null, fn: Callback<T, unknown>, thisArg: any = this): void {
    if (start === null) return;
    const cursor = this.allocateCursor(start, null);
    while (cursor.prev !== null) {
      const item = cursor.prev;
      cursor.prev = item.prev;
      if (fn.call(thisArg, item.data, item, this)) break;
    }
    this.releaseCursor();
  }

  clear(): void {
    this.head = null;
    this.tail = null;
  }

  copy(): List<T> {
    const result = new List<T>();
    for (const data of this) result.appendData(data);
    return result;
  }

  prepend(item: ListItem<T>): this {
    this.updateCursors(null, item, this.head, item);
    if (this.head !== null) {
      this.head.prev = item;
      item.next = this.head;
    } else {
      this.tail = item;
    }
    this.head = item;
    return this;
  }

  prependData(data: T): this {
    return this.prepend(List.createItem(data));
  }

  append(item: ListItem<T>): this {
    return this.insert(item);
  }

  appendData(data: T): this {
    return this.insert(List.createItem(data));
  }

  insert(item: ListItem<T>, before: ListItem<T> | null = null): this {
    if (before !== null) {
      this.updateCursors(before.prev, item, before, item);
      if (before.prev === null) {
        if (this.head !== before) throw new Error("before doesn't belong to list");
        this.head = item;
        before.prev = item;
        item.next = before;
        this.updateCursors(null, item);
      } else {
        before.prev.next = item;
        item.prev = before.prev;
        before.prev = item;
        item.next = before;
      }
    } else {
      this.updateCursors(this.tail, item, null, item);
      if (this.tail !== null) {
        this.tail.next = item;
        item.prev = this.tail;
      } else {
        this.head = item;
      }
      this.tail = item;
    }
    return this;
  }

  insertData(data: T, before?: ListItem<T> | null): this {
    return this.insert(List.createItem(data), before);
  }

  remove(item: ListItem<T>): ListItem<T> {
    this.updateCursors(item, item.prev, item, item.next);
    if (item.prev !== null) {
      item.prev.next = item.next;
    } else {
      if (this.head !== item) throw new Error("item doesn't belong to list");
      this.head = item.next;
    }
    if (item.next !== null) {
      item.next.prev = item.prev;
    } else {
      if (this.tail !== item) throw new Error("item doesn't belong to list");
      this.tail = item.prev;
    }
    item.prev = null;
    item.next = null;
    return item;
  }

  push(data: T): void {
    this.insert(List.createItem(data));
  }

  pop(): ListItem<T> | null {
    return this.tail !== null ? this.remove(this.tail) : null;
  }

  unshift(data: T): void {
    this.prepend(List.createItem(data));
  }

  shift(): ListItem<T> | null {
    return this.head !== null ? this.remove(this.head) : null;
  }

  prependList(list: List<T>): this {
    return this.insertList(list, this.head);
  }

  appendList(list: List<T>): this {
    return this.insertList(list);
  }

  insertList(list: List<T>, before?: ListItem<T> | null): this {
    if (list.head === null) return this;
    if (before !== undefined && before !== null) {
      this.updateCursors(before.prev, list.tail, before, list.head);
      if (before.prev !== null) {
        before.prev.next = list.head;
        list.head.prev = before.prev;
      } else {
        this.head = list.head;
      }
      before.prev = list.tail;
      list.tail!.next = before;
    } else {
      this.updateCursors(this.tail, list.tail, null, list.head);
      if (this.tail !== null) {
        this.tail.next = list.head;
        list.head.prev = this.tail;
      } else {
        this.head = list.head;
      }
      this.tail = list.tail;
    }
    list.head = null;
    list.tail = null;
    return this;
  }

  replace(oldItem: ListItem<T>, newItemOrList: ListItem<T> | List<T>): void {
    if ("head" in newItemOrList) this.insertList(newItemOrList, oldItem);
    else this.insert(newItemOrList, oldItem);
    this.remove(oldItem);
  }
}
