import { createTheme } from "@mui/material/styles"
import { themeColors } from "./themeColors"

const commonLayout = {
  "html, body, #root": {
    margin: 0,
    padding: 0,
    height: "100%",
    width: "100%",
    overflow: "hidden",
    backgroundColor: "inherit",
  },
  "::-webkit-scrollbar": { display: "none" },
  ".App": { backgroundColor: "inherit" },
}

const commonTabs = {
  MuiTabs: {
    styleOverrides: {
      root: {
        position: "sticky",
        top: 0,
        zIndex: 1200,
        width: "100%",
        boxSizing: "border-box",
        color: "inherit",
        cursor: "default",
      },
      indicator: { backgroundColor: "inherit" },
    },
  },
  MuiTab: {
    styleOverrides: {
      root: {
        minHeight: 64,
        color: "inherit",
        cursor: "default",
        "& svg": { color: "inherit", fontSize: "36px" },
        "&.Mui-selected svg": { color: "inherit" },
      },
    },
  },
  MuiButtonBase: {
    styleOverrides: {
      root: {
        cursor: "default",
      },
    },
  },
  MuiSvgIcon: {
    styleOverrides: {
      root: {
        cursor: 'default',
      },
    },
  },
}

export const lightTheme = createTheme({
  palette: {
    mode: "light",
    background: { default: themeColors.light, paper: themeColors.light },
    text: { primary: themeColors.textPrimaryLight, secondary: themeColors.textSecondaryLight },
    primary: { main: themeColors.highlightLight },
    divider: themeColors.dividerLight,
    success: { main: themeColors.successMain },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ...commonLayout,
        body: { backgroundColor: themeColors.light },
        ".app-wrapper, .App, #main, #videoContainer, .PhoneContent, .InfoContent, .CarplayContent": {
          backgroundColor: themeColors.light,
        },
      },
    },
    MuiTabs: { styleOverrides: { root: { backgroundColor: themeColors.light } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: themeColors.highlightLight },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: themeColors.highlightLight },
        },
        notchedOutline: { borderColor: themeColors.dividerLight },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: { "&.Mui-focused": { color: themeColors.highlightLight } },
      },
    },
    ...commonTabs,
  },
})

export const darkTheme = createTheme({
  palette: {
    mode: "dark",
    background: { default: themeColors.dark, paper: themeColors.dark },
    text: { primary: themeColors.textPrimaryDark, secondary: themeColors.textSecondaryDark },
    primary: { main: themeColors.highlightDark },
    divider: themeColors.dividerDark,
    success: { main: themeColors.successMain },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ...commonLayout,
        body: { backgroundColor: themeColors.dark },
        ".app-wrapper, .App, #main, #videoContainer, .PhoneContent, .InfoContent, .CarplayContent": {
          backgroundColor: themeColors.dark,
        },
      },
    },
    MuiTabs: { styleOverrides: { root: { backgroundColor: themeColors.dark } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: themeColors.highlightDark },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: themeColors.highlightDark },
        },
        notchedOutline: { borderColor: themeColors.dividerDark },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: { "&.Mui-focused": { color: themeColors.highlightDark } },
      },
    },
    ...commonTabs,
  },
})

export function initCursorHider(inactivityMs: number = 5000) {
  let timer: ReturnType<typeof setTimeout>;

  const setCursor = (value: string) => {
    const elements = [
      document.body,
      document.getElementById('main'),
      ...Array.from(document.querySelectorAll('.MuiTabs-root, .MuiTab-root, .MuiButtonBase-root, .MuiSvgIcon-root')),
    ].filter((el): el is HTMLElement => el !== null);

    elements.forEach(el => {
      el.style.setProperty('cursor', value, 'important');
    });
  };

  const reset = () => {
    clearTimeout(timer);
    setCursor('default');
    timer = setTimeout(() => {
      setCursor('none');
    }, inactivityMs);
  };

  document.addEventListener('mousemove', reset);
  reset();
}