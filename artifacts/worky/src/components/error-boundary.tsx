import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function DefaultFallback({ error, resetError }: ErrorFallbackProps) {
  return (
    <div className="grain flex min-h-[100dvh] w-full items-center justify-center bg-[hsl(var(--background))] p-6">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--destructive))] text-white">!</div>
        <h1 className="display-font mt-5 text-2xl font-bold text-[hsl(var(--foreground))]">
          Algo se desordenó
        </h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          Encontramos un problema inesperado. Probá recargar esta pantalla.
        </p>
        {/* Dev only: messages can carry API responses and other internals. */}
        {import.meta.env?.DEV ? (
          <pre className="mt-4 overflow-x-auto rounded bg-gray-100 p-3 text-left text-xs text-gray-800">
            {error.message || String(error)}
          </pre>
        ) : null}
        <button
          type="button"
          onClick={resetError}
          className="mt-5 rounded-xl bg-[hsl(var(--secondary))] px-4 py-2.5 text-sm font-bold text-white hover:bg-[hsl(215_45%_29%)]"
        >
          Intentar de nuevo
        </button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      'ErrorBoundary caught an error:',
      toError(error),
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
