import { createFileRoute, Link } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy — Champs Chicken" }, { name: "robots", content: "noindex" }] }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen pb-24">
      <Header subtitle="Privacy Policy" />
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-4">
        <div className="rounded-2xl border bg-card p-4">
          <h1 className="font-display text-2xl mb-2">Privacy Policy</h1>
          <p className="text-sm">This Privacy Policy explains how Champs Chicken ("we", "us", "our") collects, uses, and shares information when you use our website and services.</p>
          <h2 className="font-semibold mt-4">Information We Collect</h2>
          <ul className="list-disc list-inside text-sm">
            <li>Account information: name, email, phone number, address when you create an account.</li>
            <li>Order information: items ordered, order number, delivery/pickup details, and payment status.</li>
            <li>Driver information: for delivery drivers we may store bank details and verification documents to process payments.</li>
            <li>Usage data: device and browser information, IP addresses, and analytics to improve the service.</li>
          </ul>
          <h2 className="font-semibold mt-4">How We Use Information</h2>
          <ul className="list-disc list-inside text-sm">
            <li>To process and deliver your orders, including contacting you about order status.</li>
            <li>To manage accounts, verify identity, and pay drivers where applicable.</li>
            <li>To improve and personalise our service and communicate promotions when you opt in.</li>
            <li>To comply with legal obligations and to protect our rights.</li>
          </ul>
          <h2 className="font-semibold mt-4">Sharing and Disclosure</h2>
          <p className="text-sm">We do not sell your personal information. We may share necessary data with service providers (payment processors, delivery partners), and with law enforcement when required.</p>
          <h2 className="font-semibold mt-4">Data Retention</h2>
          <p className="text-sm">We retain order and account information for as long as needed to provide services and comply with legal obligations.</p>
          <h2 className="font-semibold mt-4">Your Choices</h2>
          <p className="text-sm">You can request to view, correct, or delete your personal data by contacting us. You can also opt out of marketing communications.</p>
          <h2 className="font-semibold mt-4">Contact</h2>
          <p className="text-sm">Questions or requests about this policy can be sent to champsalice@gmail.com</p>
        </div>
      </div>
      <Footer />
    </div>
  );
}
