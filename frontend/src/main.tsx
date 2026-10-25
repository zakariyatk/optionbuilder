import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DialogHost } from './components/DialogHost';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="AddStock">
      <App />
      <DialogHost />
    </ErrorBoundary>
  </StrictMode>,
);
