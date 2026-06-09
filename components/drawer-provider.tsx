"use client";

import { createContext, useContext, useState } from "react";

type DrawerCtx = { isOpen: boolean; open: () => void; close: () => void };

const Ctx = createContext<DrawerCtx>({
  isOpen: false,
  open: () => {},
  close: () => {},
});

export function useDrawer() {
  return useContext(Ctx);
}

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Ctx.Provider
      value={{ isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) }}
    >
      {children}
    </Ctx.Provider>
  );
}
