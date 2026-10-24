import "./globals.css";

export const metadata = {
  title: "HCM Lite | People Operations",
  description: "AI-assisted human capital management for Admin, HR and Employees"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
