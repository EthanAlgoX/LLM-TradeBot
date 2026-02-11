"""
BlockRun.AI Client Implementation
=================================

Pay-per-request AI gateway using x402 micropayments on Base chain.
Access GPT-4o, Claude, Gemini, DeepSeek, and more - no API keys needed.

SECURITY NOTE - Private Key Handling:
=====================================
Your private key NEVER leaves your machine. Here's what happens:

1. Key stays local - only used to sign an EIP-712 typed data message
2. Only the SIGNATURE is sent in the PAYMENT-SIGNATURE header
3. BlockRun verifies the signature on-chain via facilitator
4. Your actual private key is NEVER transmitted to any server

This is the same security model as signing a MetaMask transaction.

Setup:
    1. Get a Base chain wallet with USDC
    2. Set BLOCKRUN_WALLET_KEY in .env (your private key)
    3. Select provider "blockrun" in the dashboard

Available Models:
    - openai/gpt-4o, openai/gpt-4o-mini
    - anthropic/claude-sonnet-4, anthropic/claude-3-5-sonnet
    - google/gemini-2.5-pro, google/gemini-2.5-flash
    - deepseek/deepseek-chat, deepseek/deepseek-reasoner
    - x-ai/grok-3

Docs: https://blockrun.ai/docs
"""

import os
from typing import Dict, Any, List

from .base import BaseLLMClient, LLMConfig, ChatMessage, LLMResponse


class BlockRunClient(BaseLLMClient):
    """
    BlockRun.AI LLM Client

    Uses x402 micropayments on Base chain - pay per request in USDC.
    No traditional API keys needed, just a wallet private key.
    """

    DEFAULT_BASE_URL = "https://blockrun.ai/api/v1"
    DEFAULT_MODEL = "openai/gpt-4o"
    PROVIDER = "blockrun"

    def __init__(self, config: LLMConfig):
        """
        Initialize BlockRun client.

        Args:
            config: LLMConfig where api_key is your Base chain wallet private key
                   (or set BLOCKRUN_WALLET_KEY env var)

        Note:
            Your private key is used ONLY for local EIP-712 signing.
            The key NEVER leaves your machine - only signatures are sent.
        """
        # Import blockrun SDK
        try:
            from blockrun_llm import LLMClient as BlockRunSDK
        except ImportError:
            raise ImportError(
                "blockrun-llm package not installed. "
                "Install with: pip install blockrun-llm"
            )

        # Get private key from config or env
        private_key = config.api_key or os.environ.get("BLOCKRUN_WALLET_KEY")
        if not private_key:
            raise ValueError(
                "BlockRun requires a wallet private key. "
                "Set BLOCKRUN_WALLET_KEY in .env or pass as api_key. "
                "NOTE: Your key never leaves your machine - only signatures are sent."
            )

        # Store config
        self.config = config
        self.model = config.model or self.DEFAULT_MODEL
        self.base_url = config.base_url or self.DEFAULT_BASE_URL

        # Initialize BlockRun SDK
        # The SDK handles x402 payment flow internally
        self._sdk = BlockRunSDK(
            private_key=private_key,
            api_url=self.base_url.replace("/v1", ""),  # SDK adds /v1 internally
            timeout=float(config.timeout),
        )

    def _build_headers(self) -> Dict[str, str]:
        """Not used - SDK handles headers including payment signatures."""
        return {}

    def _build_request_body(
        self,
        messages: List[ChatMessage],
        **kwargs
    ) -> Dict[str, Any]:
        """Not used - SDK builds request internally."""
        return {}

    def _parse_response(self, response: Dict[str, Any]) -> LLMResponse:
        """Not used - SDK parses response internally."""
        return LLMResponse(content="", model=self.model, provider=self.PROVIDER)

    def chat(
        self,
        system_prompt: str,
        user_prompt: str,
        **kwargs
    ) -> LLMResponse:
        """
        Send a chat request via BlockRun.

        Args:
            system_prompt: System instructions
            user_prompt: User message
            **kwargs: Additional params (temperature, max_tokens)

        Returns:
            LLMResponse with the assistant's reply
        """
        messages = [
            ChatMessage(role="system", content=system_prompt),
            ChatMessage(role="user", content=user_prompt)
        ]
        return self.chat_messages(messages, **kwargs)

    def chat_messages(
        self,
        messages: List[ChatMessage],
        **kwargs
    ) -> LLMResponse:
        """
        Multi-turn chat via BlockRun.

        The SDK automatically handles the x402 payment flow:
        1. Sends request -> receives 402 with payment requirements
        2. Signs payment locally with your private key
        3. Retries request with payment signature
        4. Returns response

        Args:
            messages: List of ChatMessage objects
            **kwargs: Additional params

        Returns:
            LLMResponse with the assistant's reply
        """
        # Convert ChatMessage to dict format
        msg_list = [{"role": m.role, "content": m.content} for m in messages]

        # Call BlockRun SDK
        result = self._sdk.chat_completion(
            model=self.model,
            messages=msg_list,
            max_tokens=kwargs.get("max_tokens", self.config.max_tokens),
            temperature=kwargs.get("temperature", self.config.temperature),
        )

        # Convert SDK response to LLMResponse
        return LLMResponse(
            content=result.choices[0].message.content,
            model=result.model,
            provider=self.PROVIDER,
            usage={
                "prompt_tokens": result.usage.prompt_tokens if result.usage else 0,
                "completion_tokens": result.usage.completion_tokens if result.usage else 0,
                "total_tokens": result.usage.total_tokens if result.usage else 0,
            },
            raw_response=None,  # SDK doesn't expose raw response
        )

    def get_wallet_address(self) -> str:
        """Get the wallet address being used for payments."""
        return self._sdk.get_wallet_address()

    def close(self):
        """Close the HTTP client."""
        self._sdk.close()
