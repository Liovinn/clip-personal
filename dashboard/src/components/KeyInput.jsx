import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, Check } from 'lucide-react';

export default function KeyInput({ onKeySet, savedKey }) {
    const [key, setKey] = useState(savedKey || '');
    const [isVisible, setIsVisible] = useState(false);
    const [isSaved, setIsSaved] = useState(!!savedKey);

    useEffect(() => {
        if (savedKey) setKey(savedKey);
    }, [savedKey]);

    const handleSave = () => {
        if (key.trim().length > 0) {
            onKeySet(key);
            setIsSaved(true);
        }
    };

    return (
        <div className="ce-key-card card animate-fade">
            <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-paper3 rounded-input text-brass">
                    <Key size={18} />
                </div>
                <h2 className="text-sm font-medium text-ink">Gemini API key</h2>
            </div>
            <p className="ce-key-description">Connect your Gemini account to find highlights and generate clips.</p>
            <label htmlFor="clipedit-gemini-key" className="ce-field-label">API key</label>
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative sm:flex-1">
                    <input
                        id="clipedit-gemini-key"
                        aria-describedby="clipedit-key-help"
                        autoComplete="off"
                        spellCheck={false}
                        type={isVisible ? "text" : "password"}
                        value={key}
                        onChange={(e) => {
                            setKey(e.target.value);
                            setIsSaved(false);
                        }}
                        placeholder="Enter your Gemini API key"
                        className="input-field pr-12 font-mono"
                    />
                    <button
                        type="button"
                        aria-label={isVisible ? 'Hide API key' : 'Show API key'}
                        onClick={() => setIsVisible(!isVisible)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors"
                    >
                        {isVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                </div>
                <button
                    onClick={handleSave}
                    disabled={!key || isSaved}
                    className={isSaved ? 'badge-ok px-4 cursor-default' : 'btn-primary'}
                >
                    {isSaved ? <><Check size={14} /> Saved</> : 'Save key'}
                </button>
            </div>
            <p id="clipedit-key-help" className="mt-3 text-xs text-muted leading-relaxed">
                Your key is saved in this browser and used when you generate clips.
                <br />
                <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brass hover:underline mt-1 inline-block"
                >
                    Get a Gemini API key ↗
                </a>
            </p>
        </div>
    );
}
