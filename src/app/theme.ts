import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "dark",
    background: {
      default: "#0d1b2a",
      paper: "#13283c"
    },
    primary: {
      main: "#00b4d8",
      light: "#90e0ef",
      contrastText: "#061018"
    },
    secondary: {
      main: "#e0e1dd"
    },
    text: {
      primary: "#f7fbff",
      secondary: "#b9cad6"
    }
  },
  shape: {
    borderRadius: 8
  },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: {
      fontSize: "2rem",
      fontWeight: 700,
      letterSpacing: 0
    },
    h2: {
      fontSize: "1.5rem",
      fontWeight: 700,
      letterSpacing: 0
    },
    button: {
      textTransform: "none",
      fontWeight: 700,
      letterSpacing: 0
    }
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8
        }
      }
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true
      }
    }
  }
});
