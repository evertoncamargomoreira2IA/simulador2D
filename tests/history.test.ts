import { describe, expect, it } from 'vitest';
import { History } from '../src/engine/history';

describe('History', () => {
  it('desfaz e refaz na ordem correta, atualizando os indicadores', () => {
    const history = new History<number>();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo(0)).toBeUndefined();
    expect(history.redo(0)).toBeUndefined();
    history.push(0);
    history.push(1);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.undo(2)).toBe(1);
    expect(history.undo(1)).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.redo(0)).toBe(1);
    expect(history.redo(1)).toBe(2);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it('limpa o refazer quando uma nova edição é registrada', () => {
    const history = new History<number>();
    history.push(0);
    history.undo(1);
    history.push(0);
    expect(history.canRedo).toBe(false);
    expect(history.redo(2)).toBeUndefined();
    expect(history.undo(2)).toBe(0);
  });

  it('agrupa pela chave e renova a janela a cada push', () => {
    const history = new History<number>();
    history.push(0, 'move:n3', 0);
    history.push(1, 'move:n3', 500);
    history.push(2, 'move:n3', 1000);
    expect(history.undo(3)).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.redo(0)).toBe(3);
  });

  it('separa chaves diferentes e intervalos iguais ou maiores à janela', () => {
    const history = new History<number>({ coalesceMs: 100 });
    history.push(0, 'move:n3', 0);
    history.push(1, 'field:cycleTime:n3', 1);
    history.push(2, 'field:cycleTime:n3', 101);
    history.push(3, 'field:cycleTime:n3', 202);
    expect(history.undo(4)).toBe(3);
    expect(history.undo(3)).toBe(2);
    expect(history.undo(2)).toBe(1);
    expect(history.undo(1)).toBe(0);
  });

  it('nunca agrupa pushes sem chave, mesmo no mesmo instante', () => {
    const history = new History<number>();
    history.push(0, undefined, 0);
    history.push(1, undefined, 0);
    expect(history.undo(2)).toBe(1);
    expect(history.undo(1)).toBe(0);
  });

  it('quebra o agrupamento após desfazer e limpa o refazer', () => {
    const history = new History<number>();
    history.push(0, 'move:n3', 0);
    history.push(1, 'move:n3', 10);
    expect(history.undo(2)).toBe(0);
    history.push(0, 'move:n3', 20);
    expect(history.canRedo).toBe(false);
    expect(history.undo(3)).toBe(0);
    expect(history.canUndo).toBe(false);
  });

  it('descarta os estados mais antigos e reutiliza a pilha circular', () => {
    const history = new History<number>({ limit: 2 });
    history.push(0);
    history.push(1);
    history.push(2);
    expect(history.undo(3)).toBe(2);
    expect(history.undo(2)).toBe(1);
    expect(history.undo(1)).toBeUndefined();
    expect(history.redo(1)).toBe(2);
    expect(history.redo(2)).toBe(3);
    history.push(3);
    expect(history.undo(4)).toBe(3);
    expect(history.undo(3)).toBe(2);
    expect(history.canUndo).toBe(false);
  });

  it('usa limite padrão de 60 entradas', () => {
    const history = new History<number>();
    for (let i = 0; i < 61; i++) history.push(i);
    for (let i = 60; i >= 1; i--) expect(history.undo(i + 1)).toBe(i);
    expect(history.canUndo).toBe(false);
  });

  it('preserva os rótulos das ações ao desfazer, refazer e agrupar', () => {
    const history = new History<number>();
    expect(history.undoLabel).toBeUndefined();
    expect(history.redoLabel).toBeUndefined();
    history.push(0, 'move:n3', 0, 'Mover');
    history.push(1, 'move:n3', 10, 'Outro rótulo');
    expect(history.undoLabel).toBe('Mover');
    history.push(2, undefined, 20, 'Editar');
    expect(history.undoLabel).toBe('Editar');
    history.undo(3);
    expect(history.redoLabel).toBe('Editar');
    expect(history.undoLabel).toBe('Mover');
    history.undo(2);
    expect(history.redoLabel).toBe('Mover');
    history.redo(0);
    expect(history.undoLabel).toBe('Mover');
    expect(history.redoLabel).toBe('Editar');
    history.redo(2);
    expect(history.undoLabel).toBe('Editar');
    expect(history.redoLabel).toBeUndefined();
  });

  it('limpa estados, rótulos e agrupamento sem copiar os estados', () => {
    const history = new History<{ value: number }>();
    const initial = { value: 0 };
    history.push(initial, 'move', 0, 'Mover');
    expect(history.undo({ value: 1 })).toBe(initial);
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undoLabel).toBeUndefined();
    expect(history.redoLabel).toBeUndefined();
    history.push(initial, 'move', 1);
    expect(history.undo({ value: 2 })).toBe(initial);
  });
});
