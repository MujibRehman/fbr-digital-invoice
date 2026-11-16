import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
export function useResource(path) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({
    data: null,
    loading: true,
    error: "",
    path,
  });
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!path) {
      setState({ data: null, path, loading: false, error: "" });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, path, loading: true, error: "" }));
    api(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ data, path, loading: false, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ data: null, path, loading: false, error: error.message });
      });
    return () => controller.abort();
  }, [path, revision]);
  return { ...state, loading: state.loading || state.path !== path, reload };
}
