import { CssBaseline, ThemeProvider } from "@mui/material";
import { AppFrame } from "../components/layout/AppFrame";
import { AppRoutes } from "./routes";
import { theme } from "./theme";

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppFrame>
        <AppRoutes />
      </AppFrame>
    </ThemeProvider>
  );
}
