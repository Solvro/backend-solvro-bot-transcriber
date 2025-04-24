import { StorageItem } from '@mytypes/storage';
class Storage {
  private data: StorageItem[] = [];

  save(key: string, value: any): void {
    const existingIndex = this.data.findIndex(item => item.key === key);

    if (existingIndex !== -1)
      this.data[existingIndex].value = value;
    else
      this.data.push({ key, value });
  }

  get(key: string): any | undefined {
    const item = this.data.find(item => item.key === key);
    return item?.value;
  }

  remove(key: string): void {
    this.data = this.data.filter(item => item.key !== key);
  }

  clear(): void {
    this.data = [];
  }
}

export const storage = new Storage();