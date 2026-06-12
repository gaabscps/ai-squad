// Registra os matchers de DOM (toBeInTheDocument, etc.). Só estende o expect —
// seguro de importar mesmo nos testes de backend (ambiente node), pois os
// matchers só rodam quando chamados, dentro dos testes jsdom.
import "@testing-library/jest-dom/vitest";
