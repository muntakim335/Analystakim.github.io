"""Entry point: python -m bot.main --mode {plan,trade,report}"""

import argparse


def main():
    parser = argparse.ArgumentParser(description="Automated paper-trading bot")
    parser.add_argument("--mode", required=True, choices=["plan", "trade", "report"])
    args = parser.parse_args()

    if args.mode == "plan":
        from . import planner
        planner.run()
    elif args.mode == "trade":
        from . import trader
        trader.run()
    else:
        from . import reporter
        reporter.run()


if __name__ == "__main__":
    main()
