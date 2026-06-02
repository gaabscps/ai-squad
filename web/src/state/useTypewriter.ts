import { useEffect, useRef, useState } from "react";

/**
 * Revela `target` caractere a caractere, suave, como os chats modernos.
 *
 * Os chunks do WS chegam em rajadas de 3-4 palavras; anexar direto dá um efeito
 * "quadrado". Aqui a *exibição* é desacoplada da *chegada*: a cada frame avança
 * `max(2, ceil(restante/30))` caracteres — ritmo adaptativo que fica suave mas
 * drena o backlog em ~30 frames, pra não ficar muito atrás de um stream rápido.
 *
 * `animate=false` (ex.: texto veio do cache) → devolve `target` inteiro na hora.
 * Quando `target` cresce (novo chunk), continua de onde parou.
 *
 * Usa setTimeout (não requestAnimationFrame) de propósito: o rAF é pausado pelo
 * navegador quando a aba está oculta, o que congelaria o reveal no meio; o
 * setTimeout continua disparando em background, então o resumo sempre completa.
 */
const TICK_MS = 20; // ~50fps em foco; imperceptível para texto

export function useTypewriter(target: string, animate: boolean): string {
  const [revealed, setRevealed] = useState(0);
  const revealedRef = useRef(0);
  revealedRef.current = revealed;

  useEffect(() => {
    if (!animate) {
      revealedRef.current = target.length;
      setRevealed(target.length);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (cancelled || revealedRef.current >= target.length) return; // alcançou o alvo: para
      const step = Math.max(2, Math.ceil((target.length - revealedRef.current) / 30));
      const next = Math.min(target.length, revealedRef.current + step);
      revealedRef.current = next;
      setRevealed(next);
      timer = setTimeout(tick, TICK_MS);
    };
    timer = setTimeout(tick, TICK_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [target, animate]);

  return animate ? target.slice(0, Math.min(revealed, target.length)) : target;
}
