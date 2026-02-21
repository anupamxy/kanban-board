import React from 'react';
import { Board } from './components/Board/Board';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary context="app">
      <Board />
    </ErrorBoundary>
  );
}
