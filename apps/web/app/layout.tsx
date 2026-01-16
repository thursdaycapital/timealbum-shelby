import "./globals.css";

export const metadata = {
  title: "Time Album (Shelby)",
  description: "Public time-based photo album publisher"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
