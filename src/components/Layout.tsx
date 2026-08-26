import React from "react";
import { RecoilRoot } from "recoil";
import App from "../Main"; 

const Layout: React.FC = () => {
  return (
    <RecoilRoot>
      <App />
    </RecoilRoot>
  );
};

export default Layout;