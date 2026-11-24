import { describe, expect, it } from 'vitest';
import { isOperatorMainFrame, PickedFile } from '../callers';

const contents = (id: number) => { const mainFrame = { id: `main-${id}` }; return { id, mainFrame }; };

describe('who may call sensitive functions', () => {
  const operator = contents(1);
  const graphics = contents(2);
  const windows = () => [{ webContents: operator }] as any;
  it('accepts the main frame of an operator window', () => {
    expect(isOperatorMainFrame({ sender: operator, senderFrame: operator.mainFrame } as any, windows)).toBe(true);
  });
  it('refuses a frame inside an operator window', () => {
    expect(isOperatorMainFrame({ sender: operator, senderFrame: { id: 'sub' } } as any, windows)).toBe(false);
  });
  it('refuses any other window', () => {
    expect(isOperatorMainFrame({ sender: graphics, senderFrame: graphics.mainFrame } as any, windows)).toBe(false);
  });
  it('refuses a missing frame', () => {
    expect(isOperatorMainFrame({ sender: operator, senderFrame: null } as any, windows)).toBe(false);
  });
});

describe('the file picked for import', () => {
  it('can be used once, and only that file', () => {
    const picked = new PickedFile();
    picked.remember('/home/op/Downloads/look.zip');
    expect(picked.take('/home/op/Downloads/other.zip')).toBe(false);
    expect(picked.take('/home/op/Downloads/look.zip')).toBe(true);
    expect(picked.take('/home/op/Downloads/look.zip')).toBe(false);
  });
  it('accepts nothing before a pick', () => {
    expect(new PickedFile().take('/tmp/x.zip')).toBe(false);
  });

  it('keeps a file picked in the dialog when another arrives from the system', () => {
    const picked = new PickedFile();
    picked.remember('/a.splitlook');
    picked.remember('/b.splitlook');
    expect(picked.take('/a.splitlook')).toBe(true);
    expect(picked.take('/b.splitlook')).toBe(true);
    expect(picked.take('/a.splitlook')).toBe(false);
  });
});
