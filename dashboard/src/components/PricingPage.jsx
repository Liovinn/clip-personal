import PricingSection from './PricingSection';

// Keep the existing hosted billing flow focused on clip generation.
export default function PricingPage({ onRequireLogin }) {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="text-center max-w-xl mx-auto mb-8">
        <p className="eyebrow mb-3">Clip generator</p>
        <h1 className="font-display lowercase text-3xl sm:text-4xl text-ink">More minutes for your videos</h1>
        <p className="text-sm text-muted mt-4">
          Turn video URLs or uploads into short clips. Preview your results,
          adjust captions and framing, and download your clips.
        </p>
      </div>
      <PricingSection onRequireLogin={onRequireLogin} />
    </div>
  );
}
